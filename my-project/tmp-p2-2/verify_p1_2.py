#!/usr/bin/env python3
"""
P2-2 verification harness — re-validates P1-2's BUG-26 and BUG-30 fixes against
the CURRENT on-disk main.py (extracted via ast; no import side effects).

Tests:
  T1  BUG-30: _users_sub_status_map(uid) == _user_sub_status(uid) per user
      (all dict fields), across: active d>0 / d==0 (last day) / d<0 (expired),
      active-with-unparseable-expire (fallback), no-active-with-history
      (latest by created_at,id), no-sub, expire_date ties, created_at ties,
      multi-chunk (>500 users -> 2 chunks), duplicate uids, empty list.
  T2  BUG-30: _filter_users(users, fkey) output (selection + ORDER) identical
      to the original per-user predicates for all 7 fkeys.
  T3  BUG-30: _users_selfbot_stats_map (total, manual) == per-user counts.
  T4  BUG-26: _prune_gate_state — under-cap no-op; 48h TTL eviction;
      stale-ts cleanup; oldest-first cap eviction; _gate_msg_id insertion-order
      cap; set-type preserved; live entries never evicted under cap.
"""
import ast, os, sqlite3, sys, time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

MAIN = "/home/z/cianet-review/main.py"
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "test.db")
if os.path.exists(DB):
    os.remove(DB)

_DATE_FMT = "%Y-%m-%d %H:%M:%S"

@contextmanager
def _conn():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    try:
        yield c
    finally:
        c.close()

@contextmanager
def _conn_immediate():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("BEGIN IMMEDIATE")
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()

# ── extract source of needed functions from live main.py ──────────────────
src = open(MAIN, encoding="utf-8").read()
tree = ast.parse(src)

WANT_MOD = {"_parse_date", "_subscription_days_left", "get_active_subscription",
            "account_belongs_to"}
WANT_METH = {"_user_sub_status", "_users_sub_status_map", "_users_selfbot_stats_map",
             "_filter_users", "_prune_gate_state"}
found_mod, found_meth = {}, {}
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in WANT_MOD:
        found_mod[node.name] = ast.get_source_segment(src, node)
    if isinstance(node, ast.ClassDef) and node.name == "SaaSBot":
        for sub in node.body:
            if isinstance(sub, ast.FunctionDef) and sub.name in WANT_METH:
                found_meth[sub.name] = ast.get_source_segment(src, sub)
        for sub in node.body:
            if isinstance(sub, ast.Assign):
                for t in sub.targets:
                    if isinstance(t, ast.Name) and t.id in ("_GATE_STATE_MAX", "_SUB_QUERY_CHUNK"):
                        found_meth[t.id] = ast.get_source_segment(src, sub)
missing = (WANT_MOD | WANT_METH) - set(found_mod) - set(found_meth)
assert not missing, f"extraction failed: {missing}"

ns = {
    "_conn": _conn, "_conn_immediate": _conn_immediate,
    "datetime": datetime, "timezone": timezone, "timedelta": timedelta,
    "PROVISION_MANUAL": "manual", "ACCOUNTS": {}, "time": time,
    "_GATE_RETRY_COOLDOWN": 5, "_DATE_FMT": _DATE_FMT,
}
for name, code in found_mod.items():
    exec(compile(ast.Module(body=ast.parse(code).body, type_ignores=[]), name, "exec"), ns)

class FakeSB:  # self.sb
    def __init__(self, cfg):
        self._cfg = cfg
        self.ACCOUNTS = {}
    def load_config(self): return self._cfg

class Bot:  # minimal instance carrying the extracted methods
    pass

meth_ns = dict(ns)
for name in WANT_METH:
    exec(compile(ast.Module(body=ast.parse(found_meth[name]).body, type_ignores=[]), name, "exec"), meth_ns)
    setattr(Bot, name, meth_ns[name])
exec(found_meth["_GATE_STATE_MAX"].strip(), meth_ns)
setattr(Bot, "_GATE_STATE_MAX", meth_ns["_GATE_STATE_MAX"])
exec(found_meth["_SUB_QUERY_CHUNK"].strip(), meth_ns)
setattr(Bot, "_SUB_QUERY_CHUNK", meth_ns["_SUB_QUERY_CHUNK"])

# ── schema (mirrors init_db subscriptions shape as used by the queries) ───
with _conn_immediate() as c:
    c.execute("""CREATE TABLE subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        plan TEXT, status TEXT DEFAULT 'active',
        expire_date TEXT, created_at TEXT DEFAULT (datetime('now'))
    )""")

today = datetime.now(timezone.utc).date()
def dstr(offset_days): return (today + timedelta(days=offset_days)).strftime("%Y-%m-%d")
def ts(offset_hours): return (datetime.now(timezone.utc) + timedelta(hours=offset_hours)).strftime("%Y-%m-%d %H:%M:%S")

CUR = 1
def add_sub(uid, status="active", expire=None, created=None, plan="پلن تست"):
    global CUR
    with _conn_immediate() as c:
        c.execute("INSERT INTO subscriptions (user_id, plan, status, expire_date, created_at) VALUES (?,?,?,?,?)",
                  (uid, plan, status, expire if expire is not None else dstr(30),
                   created if created is not None else ts(-CUR)))
    CUR += 1

CASES = []  # (uid, description)
u = 1001; add_sub(u, expire=dstr(5), created=ts(-100)); CASES.append((u, "active d=5"))
u = 1002; add_sub(u, expire=dstr(0), created=ts(-99)); CASES.append((u, "active d=0 (last day)"))
u = 1003; add_sub(u, expire=dstr(-3), created=ts(-98)); CASES.append((u, "active-status but expired d=-3"))
u = 1004; add_sub(u, expire="garbage-date", created=ts(-97)); add_sub(u, status="cancelled", expire=dstr(-10), created=ts(-5)); CASES.append((u, "unparseable active -> fallback"))
u = 1005; add_sub(u, status="cancelled", expire=dstr(-40), created=ts(-96)); add_sub(u, status="cancelled", expire=dstr(-20), created=ts(-50)); add_sub(u, status="expired", expire=dstr(-15), created=ts(-10)); CASES.append((u, "no active, latest history"))
CASES.append((1006, "nosub"))
u = 1007; add_sub(u, expire=dstr(7), created=ts(-95)); add_sub(u, expire=dstr(7), created=ts(-94)); CASES.append((u, "active expire tie"))
u = 1008; tie = ts(-60); add_sub(u, status="cancelled", expire=dstr(-40), created=tie); add_sub(u, status="cancelled", expire=dstr(-25), created=tie); CASES.append((u, "created_at tie -> id desc"))
u = 1009; add_sub(u, expire=dstr(2), created=ts(-93)); add_sub(u, expire=dstr(25), created=ts(-92)); CASES.append((u, "max expire wins"))

bulk_uids = []
for i in range(500):
    u = 2000 + i
    bulk_uids.append(u)
    if i % 3 == 0:
        add_sub(u, expire=dstr(3))
    elif i % 3 == 1:
        add_sub(u, status="cancelled", expire=dstr(-9), created=ts(-80))

users = [{"user_id": uid, "username": f"user{uid}"} for uid, _ in CASES]
users += [{"user_id": uid, "username": f"user{uid}"} for uid in bulk_uids]
users.append({"user_id": 1001, "username": "dup"})

bot = Bot()
bot.sb = FakeSB({})

fails = 0
status_map = bot._users_sub_status_map(users)
for u_in in [uid for uid, _ in CASES] + bulk_uids:
    orig = bot._user_sub_status(u_in)
    new = status_map.get(u_in)
    if orig != new:
        print(f"  T1 FAIL uid={u_in}: orig={orig} new={new}"); fails += 1
print(f"T1 per-user status equivalence: {'OK' if not fails else 'FAIL'} "
      f"({len(CASES)+len(bulk_uids)} users incl. edge cases; "
      f"total uids={len({u['user_id'] for u in users})} -> "
      f"{'multi-chunk (chunk=500)' if len({u['user_id'] for u in users}) > 500 else 'WARNING: single chunk'})")

# T2: _filter_users output == original per-user predicates (order + membership)
def orig_filter(users, fkey):
    if fkey == "active":
        return [u for u in users if bot._user_sub_status(u["user_id"])["active"]]
    if fkey == "expired":
        return [u for u in users if bot._user_sub_status(u["user_id"])["expired"]]
    if fkey == "nosub":
        return [u for u in users if bot._user_sub_status(u["user_id"])["nosub"]]
    if fkey == "manual":
        return [u for u in users if bot._user_manual_bot_count(u["user_id"]) > 0]
    if fkey == "hasbot":
        return [u for u in users if bot._user_selfbot_stats(u["user_id"])[0] > 0]
    if fkey == "nobot":
        return [u for u in users if bot._user_selfbot_stats(u["user_id"])[0] == 0]
    return users

mns = dict(ns)
extra_src = {}
for node in tree.body:
    if isinstance(node, ast.ClassDef) and node.name == "SaaSBot":
        for sub in node.body:
            if isinstance(sub, ast.FunctionDef) and sub.name in ("_user_manual_bot_count", "_user_selfbot_stats"):
                extra_src[sub.name] = ast.get_source_segment(src, sub)
for n, c in extra_src.items():
    exec(compile(ast.Module(body=ast.parse(c).body, type_ignores=[]), n, "exec"), mns)
    setattr(Bot, n, mns[n])

cfg = {
    "acc_a": {"owner_user_id": 1001, "provision_source": "manual"},
    "acc_b": {"owner_user_id": 1001, "provision_source": "panel"},
    "acc_c": {"owner_user_id": 1005},
    "acc_d": {"tg_user_id": 1007, "provision_source": "manual"},
    "acc_e": {"owner_user_id": 999999},
}
bot.sb = FakeSB(cfg)

fails2 = 0
for fkey in ("all", "active", "expired", "nosub", "manual", "hasbot", "nobot"):
    got = bot._filter_users(users, fkey)
    want = orig_filter(users, fkey)
    if got != want:
        print(f"  T2 FAIL fkey={fkey}: len(got)={len(got)} len(want)={len(want)}"); fails2 += 1
print(f"T2 _filter_users equivalence (7 fkeys, selection+order): {'OK' if not fails2 else 'FAIL'}")

stats = bot._users_selfbot_stats_map(users)
fails3 = 0
for uid in {u["user_id"] for u in users}:
    want = (bot._user_selfbot_stats(uid)[0], bot._user_manual_bot_count(uid))
    if stats[uid] != want:
        print(f"  T3 FAIL uid={uid}: map={stats[uid]} per-user={want}"); fails3 += 1
print(f"T3 selfbot stats map equivalence: {'OK' if not fails3 else 'FAIL'}")

# ── T4: BUG-26 prune simulation ───────────────────────────────────────────
MAX = Bot._GATE_STATE_MAX
now = 1_000_000.0

class GateBot:
    _GATE_STATE_MAX = MAX
GateBot._prune_gate_state = Bot._prune_gate_state
g = GateBot()

def fresh():
    g._gate_cache = {}; g._gate_retry_ts = {}
    g._gate_blocked = set(); g._gate_blocked_ts = {}; g._gate_msg_id = {}

fails4 = []
fresh()
for i in range(50):
    g._gate_blocked.add(i); g._gate_blocked_ts[i] = now - 100
    g._gate_msg_id[i] = i * 10
g._prune_gate_state(now)
if len(g._gate_blocked) != 50 or len(g._gate_blocked_ts) != 50 or len(g._gate_msg_id) != 50:
    fails4.append("4a under-cap no-op")

fresh()
for i in range(MAX + 10):
    g._gate_blocked.add(i)
    g._gate_blocked_ts[i] = now - 49 * 3600 if i < 5 else now - 3600  # 5 stale, rest live
g._prune_gate_state(now)
# TTL pass must evict the 5 >48h-stale entries; then 2005 > MAX=2000 -> cap
# stage evicts 5 more oldest-ts (all live ts equal -> stable order). Set lands on MAX.
if len(g._gate_blocked) != MAX:
    fails4.append(f"4b TTL+cap (blocked={len(g._gate_blocked)}, want MAX={MAX})")
if any(i in g._gate_blocked for i in range(5)):
    fails4.append("4b stale (>48h) entry survived TTL")
if any(t < now - 48 * 3600 for t in g._gate_blocked_ts.values()):
    fails4.append("4b stale ts survived TTL")

# 4c: ts entries for already-rejoined users are retained LAZILY while fresh
# (<48h) — benign: _gate_blocked_ts is read ONLY by _prune_gate_state itself
# (grep-verified), bounded by the 48h TTL; the live set must stay exact.
fresh()
for i in range(MAX + 20):
    g._gate_blocked_ts[i] = now - 100
for i in range(30):
    g._gate_blocked.add(i)
g._prune_gate_state(now)
if len(g._gate_blocked) != 30:
    fails4.append(f"4c live set changed (set={len(g._gate_blocked)}, want 30)")
if len(g._gate_blocked_ts) < 30:
    fails4.append("4c ts lost entries for still-blocked (live) users")

# 4c2: once ts entries age past 48h they ARE evicted by the TTL pass
fresh()
for i in range(2100):
    g._gate_blocked_ts[i] = now - 49 * 3600
    g._gate_blocked.add(i)
g._prune_gate_state(now)
if len(g._gate_blocked_ts) != 0 or len(g._gate_blocked) != 0:
    fails4.append(f"4c2 aged ts not evicted (ts={len(g._gate_blocked_ts)}, set={len(g._gate_blocked)})")

fresh()
N = MAX + 300
for i in range(N):
    g._gate_blocked.add(i)
    g._gate_blocked_ts[i] = now - (N - i)
g._prune_gate_state(now)
if len(g._gate_blocked) > MAX:
    fails4.append(f"4d cap evict (blocked={len(g._gate_blocked)} > MAX)")
newest = set(range(N - 50, N))
if not newest <= g._gate_blocked:
    fails4.append("4d newest entries evicted (should be oldest-first)")

fresh()
for i in range(MAX + 40):
    g._gate_msg_id[i] = i
g._prune_gate_state(now)
if len(g._gate_msg_id) != MAX:
    fails4.append(f"4e msg_id cap (len={len(g._gate_msg_id)})")
if any(k not in g._gate_msg_id for k in range(40, MAX + 40)):
    fails4.append("4e msg_id kept wrong end (should keep newest insertions)")

if not isinstance(g._gate_blocked, set):
    fails4.append("4f _gate_blocked is not a set")

fresh()
for i in range(MAX + 5):
    g._gate_cache[i] = (now - 400 if i < 5 else now - 10, True)
g._prune_gate_state(now)
if len(g._gate_cache) != MAX or any(i in g._gate_cache for i in range(5)):
    fails4.append(f"4g gate_cache TTL (len={len(g._gate_cache)})")

fresh()
for i in range(MAX + 5):
    g._gate_retry_ts[i] = now - 400 if i < 5 else now - 5
g._prune_gate_state(now)
if len(g._gate_retry_ts) != MAX or any(i in g._gate_retry_ts for i in range(5)):
    fails4.append(f"4h retry_ts TTL (len={len(g._gate_retry_ts)})")

print(f"T4 _prune_gate_state simulation (10 scenarios): "
      f"{'OK' if not fails4 else 'FAIL: ' + '; '.join(fails4)}")

rc = 0 if not (fails or fails2 or fails3 or fails4) else 1
print("RESULT:", "ALL PASS" if rc == 0 else "FAILURES PRESENT")
sys.exit(rc)
