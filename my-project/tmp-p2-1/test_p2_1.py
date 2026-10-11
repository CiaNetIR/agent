#!/usr/bin/env python3
"""P2-1 region A verifier harness.

Extracts the REAL function sources from /home/z/cianet-review/main.py via ast
(no import side effects; telethon absent in env), executes them against a temp
sqlite DB with the real schema, and drives:

  A. create_auto_reply ownership gate (P2-1 residual fix #1)
  B. create_order compensating discount rollback (P2-1 residual fix #2)
  C. P1-1 BUG-29 re-verification under concurrency (inc_setting + order_seq)
  D. P1-1 BUG-2d re-verification (create_scheduled_message gate)
  E. P1-1 BUG-24 re-verification (run_admin_bot_forever backoff, virtual clock)
"""
import ast, asyncio, json, os, shutil, sqlite3, sys, tempfile, threading, time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

MAIN = "/home/z/cianet-review/main.py"
SRC = open(MAIN, encoding="utf-8").read()
TREE = ast.parse(SRC)

WANT = {"_conn", "_conn_immediate", "inc_setting", "apply_discount_code",
        "create_order", "get_order", "cancel_order", "create_scheduled_message",
        "create_auto_reply", "account_belongs_to", "is_owner_bypass",
        "load_config", "run_admin_bot_forever"}

extracted = {}
_src_lines = SRC.splitlines()
for node in TREE.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in WANT:
        # include decorator lines (ast.get_source_segment starts at `def`)
        start = min([node.lineno] + [d.lineno for d in node.decorator_list])
        extracted[node.name] = "\n".join(_src_lines[start - 1:node.end_lineno])
missing = WANT - set(extracted)
assert not missing, f"extraction failed: {missing}"

# ---- schema (verbatim from init_db) ----
SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    plan TEXT NOT NULL,
    amount_toman INTEGER NOT NULL,
    amount_usdt REAL NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','paid','expired','cancelled')),
    pay_method TEXT, txid TEXT, payment_id INTEGER,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, paid_at TEXT,
    discount_code TEXT, discount_percent INTEGER DEFAULT 0,
    original_amount_toman INTEGER
);
CREATE TABLE IF NOT EXISTS discount_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    percent INTEGER NOT NULL CHECK(percent > 0 AND percent <= 100),
    max_uses INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT, created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    tag TEXT NOT NULL, chat_id INTEGER NOT NULL, text TEXT NOT NULL,
    scheduled_at TEXT NOT NULL, sent INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auto_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    tag TEXT NOT NULL, keyword TEXT NOT NULL, reply TEXT NOT NULL,
    is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL
);
"""

WORK = tempfile.mkdtemp(prefix="p2-1-")
DB = os.path.join(WORK, "test.db")
CFG = os.path.join(WORK, "config.json")

RESULTS = []
def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(f"{'✅' if cond else '❌'} {name}" + (f"  [{detail}]" if detail and not cond else ""))

def build_ns(db_path=DB, cfg_path=CFG, config_dict=None):
    """Compile extracted real functions into a fresh namespace."""
    if config_dict is None:
        config_dict = {}
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(config_dict, f)
    ns = {
        "__name__": "main_under_test",
        "sqlite3": sqlite3, "os": os, "json": json, "time": time,
        "datetime": datetime, "timedelta": timedelta, "timezone": timezone,
        "contextmanager": contextmanager,
        "DB_PATH": db_path,
        "CONFIG_FILE": cfg_path,
        "ACCOUNTS": {},
        "IS_DEDICATED_BOT": False,
        "OWNER_IDS": {999}, "ADMIN_ID": 999,
        "CONFIG_MISSING": "missing", "CONFIG_VALID": "valid", "CONFIG_INVALID": "invalid",
        "_config_state": None, "_CONFIG_CACHE": None, "_CONFIG_CYCLE": None,
        "_CONFIG_CACHE_MTIME": 0.0,
        "ORDER_EXPIRE_HOURS": 24,
        "_DATETIME_FMT": "%Y-%m-%d %H:%M:%S",
        "print": print,
    }
    def _now():
        return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    ns["_now"] = _now
    for fn in ("_conn", "_conn_immediate", "load_config", "is_owner_bypass",
               "account_belongs_to", "inc_setting", "apply_discount_code",
               "get_order", "cancel_order", "create_scheduled_message",
               "create_auto_reply", "create_order"):
        exec(compile(ast.parse(extracted[fn], filename=f"<{fn}>"), f"<{fn}>", "exec"), ns)
    return ns

def fresh_db():
    if os.path.exists(DB):
        os.remove(DB)
    c = sqlite3.connect(DB)
    c.executescript(SCHEMA)
    c.commit(); c.close()

def q(sql, *args):
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    r = c.execute(sql, args).fetchall(); c.close()
    return [dict(x) for x in r]

def add_code(code, percent=10, max_uses=5, used=0, active=1):
    c = sqlite3.connect(DB)
    c.execute("INSERT INTO discount_codes (code, percent, max_uses, used_count, "
              "expires_at, created_by, created_at, is_active) VALUES (?,?,?,?,NULL,999,?,?)",
              (code, percent, max_uses, used, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), active))
    c.commit(); c.close()

# ════════════════════════ A. create_auto_reply gate ════════════════════════
print("\n── A. create_auto_reply ownership gate (P2-1 fix #1) ──")
fresh_db()
ns = build_ns(config_dict={
    "acc1": {"owner_user_id": 111, "phone": "+989120000001"},
    "acc2": {"tg_user_id": 222, "phone": "+989120000002"},
})
r = ns["create_auto_reply"](111, "acc1", "سلام", "درود!")
check("A1 own tag (owner_user_id) accepted", r.get("ok") and isinstance(r.get("id"), int), str(r))
rows = q("SELECT * FROM auto_replies")
check("A1 row inserted with correct user/tag", len(rows) == 1 and rows[0]["user_id"] == 111 and rows[0]["tag"] == "acc1")

r = ns["create_auto_reply"](222, "acc1", "سلام", "درود!")
check("A2 foreign tag rejected", r == {"error": "account_not_owned"}, str(r))
check("A2 no row inserted", len(q("SELECT * FROM auto_replies")) == 1)

r = ns["create_auto_reply"](111, "ghost", "سلام", "درود!")
check("A3 non-existent tag fail-closed", r == {"error": "account_not_owned"}, str(r))

r = ns["create_auto_reply"](999, "acc1", "owner_kw", "owner reply")
check("A4 OWNER bypass (§20.1) allowed", r.get("ok") is True, str(r))

r = ns["create_auto_reply"](222, "acc2", "kw2", "r2")
check("A5 own tag via tg_user_id accepted", r.get("ok") is True, str(r))

r = ns["create_auto_reply"](111, "acc1", "", "x")
check("A6 missing_fields validation intact", r == {"error": "missing_fields"}, str(r))
r = ns["create_auto_reply"](111, "acc1", "   ", "x")
check("A7 empty_after_trim validation intact", r == {"error": "empty_after_trim"}, str(r))

# broken config → load_config returns {} → fail-closed
with open(CFG, "w") as f:
    f.write("{NOT VALID JSON")
ns2 = build_ns(config_dict={"irrelevant": {}})  # resets cache globals
with open(CFG, "w") as f:
    f.write("{NOT VALID JSON")
r = ns2["create_auto_reply"](111, "acc1", "kw", "reply")
check("A8 broken config.json fail-closed", r == {"error": "account_not_owned"}, str(r))

# ════════════════════════ B. create_order rollback ════════════════════════
print("\n── B. create_order compensating discount rollback (P2-1 fix #2) ──")
fresh_db()
ns = build_ns(config_dict={})
add_code("SAVE10", percent=10, max_uses=5, used=0)

# B1: success path identical
o = ns["create_order"](111, "پلن طلایی", 100000, 10.0, discount_code="SAVE10")
check("B1 success: order returned", o and o.get("order_no") == "ORD-00001" and o["status"] == "pending", str(o))
check("B1 discounted amount 90000", o["amount_toman"] == 90000, str(o.get("amount_toman")))
check("B1 discount fields stored", o["discount_code"] == "SAVE10" and o["discount_percent"] == 10 and o["original_amount_toman"] == 100000, str(o))
check("B1 used_count burned to 1", q("SELECT used_count FROM discount_codes WHERE code='SAVE10'")[0]["used_count"] == 1)
check("B1 usdt recalculated", o["amount_usdt"] == 9.0, str(o.get("amount_usdt")))

# B2: failure path with discount → rollback + re-raise
add_code("BURN20", percent=20, max_uses=5, used=0)
c = sqlite3.connect(DB)
c.execute("INSERT INTO orders (order_no, user_id, plan, amount_toman, amount_usdt, status, created_at, expires_at) "
          "VALUES ('ORD-00002', 1, 'x', 1, 1, 'pending', '2026-01-01 00:00:00', '2026-01-02 00:00:00')")
c.execute("INSERT INTO settings (key, value) VALUES ('order_seq', '1') "
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value")  # next seq → 2 → collision
c.commit(); c.close()
n_orders_before = len(q("SELECT * FROM orders"))
raised = None
try:
    ns["create_order"](111, "پلن طلایی", 50000, 5.0, discount_code="BURN20")
except Exception as e:
    raised = e
check("B2 INSERT failure raises (behavior preserved)", isinstance(raised, sqlite3.IntegrityError), f"{type(raised).__name__}: {raised}")
check("B2 used_count rolled back to 0",
      q("SELECT used_count FROM discount_codes WHERE code='BURN20'")[0]["used_count"] == 0)
check("B2 no new order row", len(q("SELECT * FROM orders")) == n_orders_before)
check("B2 order_seq not leaked (tx rolled back)",
      q("SELECT value FROM settings WHERE key='order_seq'")[0]["value"] == "1")
check("B2 SAVE10 untouched by rollback", q("SELECT used_count FROM discount_codes WHERE code='SAVE10'")[0]["used_count"] == 1)

# B3: failure path WITHOUT discount → still raises, no rollback attempt
raised = None
try:
    ns["create_order"](111, "پلن", 50000, 5.0)
except Exception as e:
    raised = e
check("B3 no-discount failure still raises", isinstance(raised, sqlite3.IntegrityError), type(raised).__name__)
check("B3 no discount codes harmed",
      q("SELECT used_count FROM discount_codes WHERE code='BURN20'")[0]["used_count"] == 0)

# B4: rollback itself fails → non-fatal, original error still propagates
fresh_db()
ns3 = build_ns(config_dict={})
add_code("FAIL30", percent=30, max_uses=5, used=0)
real_ci = ns3["_conn_immediate"]
calls = {"n": 0}
@contextmanager
def flaky_ci():
    calls["n"] += 1
    if calls["n"] >= 3:          # 1=apply burn, 2=order tx (fails), 3=rollback → boom
        raise RuntimeError("simulated db lock during rollback")
    with real_ci() as c:
        yield c
ns3["_conn_immediate"] = flaky_ci
c = sqlite3.connect(DB)
c.execute("INSERT INTO orders (order_no, user_id, plan, amount_toman, amount_usdt, status, created_at, expires_at) "
          "VALUES ('ORD-00001', 1, 'x', 1, 1, 'pending', '2026-01-01 00:00:00', '2026-01-02 00:00:00')")
c.execute("INSERT INTO settings (key, value) VALUES ('order_seq', '0')")
c.commit(); c.close()
raised = None
try:
    ns3["create_order"](111, "پلن", 50000, 5.0, discount_code="FAIL30")
except Exception as e:
    raised = e
check("B4 rollback failure non-fatal: original IntegrityError propagates",
      isinstance(raised, sqlite3.IntegrityError), f"{type(raised).__name__}: {raised}")
check("B4 burned count stays 1 (logged warning path)",
      q("SELECT used_count FROM discount_codes WHERE code='FAIL30'")[0]["used_count"] == 1)

# B5: MAX(0, ...) guard — used_count already 0 rollback cannot go negative
fresh_db()
ns4 = build_ns(config_dict={})
add_code("ZERO", percent=10, max_uses=5, used=0)
ns4["apply_discount_code"]("ZERO", 1000)   # burn 0→1
_c5 = sqlite3.connect(DB)                  # simulate external reset of used_count
_c5.execute("UPDATE discount_codes SET used_count = 0 WHERE code='ZERO'")
_c5.commit(); _c5.close()
c = sqlite3.connect(DB)
c.execute("INSERT INTO orders (order_no, user_id, plan, amount_toman, amount_usdt, status, created_at, expires_at) "
          "VALUES ('ORD-00001', 1, 'x', 1, 1, 'pending', '2026-01-01 00:00:00', '2026-01-02 00:00:00')")
c.execute("INSERT INTO settings (key, value) VALUES ('order_seq', '0')"); c.commit(); c.close()
try:
    ns4["create_order"](111, "پلن", 5000, 0.5, discount_code="ZERO")
    raised = "NO RAISE"
except Exception as e:
    raised = e
check("B5 raises on collision", isinstance(raised, sqlite3.IntegrityError), str(raised))
check("B5 used_count not negative", q("SELECT used_count FROM discount_codes WHERE code='ZERO'")[0]["used_count"] == 0)

# ══════════════════ C. P1-1 BUG-29 re-verification (concurrency) ══════════════════
print("\n── C. P1-1 BUG-29 atomicity re-verification ──")
fresh_db()
ns = build_ns(config_dict={})
errs = []
def worker_inc():
    try:
        for _ in range(25):
            ns["inc_setting"]("gate_blocked_count")
    except Exception as e:
        errs.append(e)
ts = [threading.Thread(target=worker_inc) for _ in range(8)]
[t.start() for t in ts]; [t.join() for t in ts]
val = q("SELECT value FROM settings WHERE key='gate_blocked_count'")
check("C1 inc_setting: 8×25 concurrent = exactly 200", not errs and val and val[0]["value"] == "200",
      f"value={val}, errors={errs[:2]}")

fresh_db()
ns = build_ns(config_dict={})
errs2 = []
def worker_order(i):
    try:
        for _ in range(25):
            o = ns["create_order"](1000 + i, "پلن", 10000, 1.0)
            assert o and o.get("id"), f"bad order: {o}"
    except Exception as e:
        errs2.append(f"t{i}:{type(e).__name__}:{e}")
ts = [threading.Thread(target=worker_order, args=(i,)) for i in range(8)]
[t.start() for t in ts]; [t.join() for t in ts]
orders = q("SELECT order_no FROM orders")
seq = q("SELECT value FROM settings WHERE key='order_seq'")
check("C2 create_order: 200/200 created, zero errors", not errs2 and len(orders) == 200, f"errors={errs2[:3]}")
check("C2 all order_no unique", len({o["order_no"] for o in orders}) == 200)
check("C2 order_seq exact 200", seq and seq[0]["value"] == "200", str(seq))

# ══════════════════ D. P1-1 BUG-2d re-verification (scheduled msg gate) ══════════════════
print("\n── D. P1-1 BUG-2d create_scheduled_message gate ──")
fresh_db()
ns = build_ns(config_dict={
    "acc1": {"owner_user_id": 111},
    "acc2": {"tg_user_id": 222},
})
r = ns["create_scheduled_message"](111, "acc1", 12345, "hi", "2026-12-01T10:00:00")
check("D1 own tag accepted", r.get("ok") is True, str(r))
r = ns["create_scheduled_message"](222, "acc1", 12345, "hi", "2026-12-01T10:00:00")
check("D2 foreign tag rejected", r == {"error": "account_not_owned"}, str(r))
r = ns["create_scheduled_message"](111, "nope", 12345, "hi", "2026-12-01T10:00:00")
check("D3 missing tag fail-closed", r == {"error": "account_not_owned"}, str(r))
r = ns["create_scheduled_message"](999, "acc1", 12345, "hi", "2026-12-01T10:00:00")
check("D4 OWNER bypass", r.get("ok") is True, str(r))
r = ns["create_scheduled_message"](111, "acc1", 12345, "hi", "")
check("D5 missing_fields intact", r == {"error": "missing_fields"}, str(r))
r = ns["create_scheduled_message"](111, "acc1", 0, "hi", "2026-12-01T10:00:00")
check("D6 invalid_chat_id intact", r == {"error": "invalid_chat_id"}, str(r))
r = ns["create_scheduled_message"](111, "acc1", 12345, "hi", "not-a-date")
check("D7 invalid_scheduled_at intact", r == {"error": "invalid_scheduled_at"}, str(r))

# ══════════════════ E. P1-1 BUG-24 re-verification (virtual clock) ══════════════════
print("\n── E. P1-1 BUG-24 run_admin_bot_forever backoff ──")

class FakeClock:
    def __init__(self): self.t = 1000.0
    def monotonic(self): return self.t
    def advance(self, s): self.t += s

class FakeAsyncioModule:
    """Records sleep() calls and advances the fake clock."""
    CancelledError = asyncio.CancelledError
    def __init__(self, clock): self.clock = clock; self.waits = []
    async def sleep(self, s):
        self.waits.append(s); self.clock.advance(s)

def run_backoff_scenario(script):
    """script: list of (mode, seconds) for each connection attempt.
    mode 'clean'  → start ok, run_until_disconnected returns after <seconds>
    mode 'error'  → start raises RuntimeError
    After script exhausted, next connection raises CancelledError → loop exits."""
    clock = FakeClock()
    fa = FakeAsyncioModule(clock)
    state = {"i": 0}
    class FakeClient:
        async def run_until_disconnected(self):
            if state["i"] >= len(script):
                raise asyncio.CancelledError()
            mode, secs = script[state["i"]]
            clock.advance(secs)
            state["i"] += 1
            if mode == "cancel":
                raise asyncio.CancelledError()
            return None  # clean disconnect
    class AdminBot:
        def __init__(self, mod, standalone=True): self.client = FakeClient()
        async def start(self):
            if state["i"] >= len(script):
                raise asyncio.CancelledError()
            mode, _ = script[state["i"]]
            if mode == "error":
                state["i"] += 1
                raise RuntimeError("boom")
    ns = {"__name__": "t", "AdminBot": AdminBot, "time": clock, "asyncio": fa,
          "print": lambda *a, **k: None, "RuntimeError": RuntimeError}
    exec(compile(ast.parse(extracted["run_admin_bot_forever"], filename="<rabf>"), "<rabf>", "exec"), ns)
    try:
        asyncio.run(ns["run_admin_bot_forever"](None))
        return fa.waits
    except asyncio.CancelledError:
        return fa.waits

# Scenario A: 3 quick clean drops, then stable 400s, then quick drop
w = run_backoff_scenario([("clean", 1), ("clean", 1), ("clean", 1), ("clean", 400), ("clean", 1)])
check("E1 3 quick clean drops → backoff 20/40/80; stable 400s resets; next quick drop → 20",
      w == [20, 40, 80, 20], str(w))

# Scenario B: 2 errors, then stable 600s, then quick clean drop
w = run_backoff_scenario([("error", 0), ("error", 0), ("clean", 600), ("clean", 1)])
check("E2 2 errors (20/40), stable 600s resets, quick drop → 20", w == [20, 40, 20], str(w))

# Scenario C: 3 consecutive errors → exception path unchanged (20/40/80)
w = run_backoff_scenario([("error", 0), ("error", 0), ("error", 0)])
check("E3 3 errors → 20/40/80 (exception path unchanged)", w == [20, 40, 80], str(w))

# Scenario D: quick clean drop right after a previous quick drop — never resets
w = run_backoff_scenario([("clean", 1), ("clean", 299), ("clean", 1)])
check("E4 uptime 299s (<300) does NOT reset → backoff keeps escalating 20/40/80",
      w == [20, 40, 80], str(w))

# Scenario E: long stable connections keep resetting (old healthy behavior preserved)
w = run_backoff_scenario([("clean", 400), ("clean", 400), ("clean", 1)])
check("E5 stable 400s cycles keep backoff reset → single quick drop waits 20", w == [20], str(w))

# ─────────────────────────────── summary ───────────────────────────────
print("\n══════════ SUMMARY ══════════")
fails = [n for n, ok, _ in RESULTS if not ok]
print(f"TOTAL: {len(RESULTS)}  PASS: {len(RESULTS)-len(fails)}  FAIL: {len(fails)}")
if fails:
    print("FAILED:", fails)
shutil.rmtree(WORK, ignore_errors=True)
sys.exit(1 if fails else 0)
