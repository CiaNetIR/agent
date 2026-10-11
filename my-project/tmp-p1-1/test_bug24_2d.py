#!/usr/bin/env python3
"""P1-1 BUG-24 + BUG-2d verification: extract the REAL functions from main.py
via ast (no import side effects) and drive them with stubs."""
import ast, sys, types, asyncio

SRC = "/home/z/cianet-review/main.py"
src = open(SRC, encoding="utf-8").read()
tree = ast.parse(src)

def get_func(name):
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    raise RuntimeError(f"{name} not found")

# ───────────────────────── BUG-2d: create_scheduled_message ─────────────────────────
g2 = {
    "__builtins__": __builtins__,
    "load_config": lambda: {"accA": {"owner_user_id": 111, "phone": "09"},
                            "accB": {"owner_user_id": 222, "phone": "09"}},
    "account_belongs_to": None,  # real one injected below (copy semantics)
    "is_owner_bypass": None,
    "_conn": None, "_now": lambda: "2026-01-01T00:00:00",
}

# use the REAL account_belongs_to + is_owner_bypass logic (simplified faithfully):
def real_account_belongs_to(acc, tag, user_id):
    if not isinstance(acc, dict) or not user_id:
        return False
    if acc.get("owner_user_id") == user_id:
        return True
    if acc.get("tg_user_id") == user_id:
        return True
    return False

class FakeCursor:
    lastrowid = 77
class FakeConn:
    def execute(self, *a, **k): return FakeCursor()
def fake_conn():
    class CM:
        def __enter__(self): return FakeConn()
        def __exit__(self, *a): return False
    return CM()

g2["account_belongs_to"] = real_account_belongs_to
g2["_conn"] = fake_conn
g2["is_owner_bypass"] = lambda uid: uid == 999  # 999 = OWNER

mod2 = types.ModuleType("m2")
mod2.__dict__.update(g2)
code2 = ast.get_source_segment(src, get_func("create_scheduled_message"))
exec(compile(code2, SRC, "exec"), mod2.__dict__)
csm = mod2.__dict__["create_scheduled_message"]

ok = True
# 1) owner of accA schedules on accA -> allowed
r = csm(111, "accA", 1001234567890, "hi", "2026-01-02T10:00:00")
assert r == {"ok": True, "id": 77}, r
# 2) user 111 (non-owner) tries accB (belongs to 222) -> REJECTED
r = csm(111, "accB", 1001234567890, "hi", "2026-01-02T10:00:00")
assert r == {"error": "account_not_owned"}, r
# 3) OWNER (999) on any tag -> allowed (bypass)
r = csm(999, "accB", 1001234567890, "hi", "2026-01-02T10:00:00")
assert r == {"ok": True, "id": 77}, r
# 4) non-existent tag, non-owner -> rejected
r = csm(111, "nope", 1001234567890, "hi", "2026-01-02T10:00:00")
assert r == {"error": "account_not_owned"}, r
# 5) existing validations untouched
assert csm(111, "", 1, "t", "x") == {"error": "missing_fields"}
assert csm(111, "accA", 0, "t", "2026-01-02T10:00:00") == {"error": "invalid_chat_id"}
assert csm(111, "accA", 1, "t", "not-a-date") == {"error": "invalid_scheduled_at"}
print("BUG-2d: ownership check behaves correctly (own tag OK, foreign tag REJECTED, OWNER bypass OK, validations intact)")

# ───────────────────────── BUG-24: run_admin_bot_forever ─────────────────────────
clock = {"t": 1000.0}
sleeps = []
class FakeAdminBot:
    cycles = 0
    plan = []  # list of ("clean", uptime_seconds) or ("raise", msg)
    def __init__(self, module, standalone=True):
        self.client = self  # real code calls admin.client.run_until_disconnected()
    async def start(self):
        pass
    async def run_until_disconnected(self):
        FakeAdminBot.cycles += 1
        if FakeAdminBot.cycles > len(FakeAdminBot.plan):
            raise SystemExit  # end the forever-loop for the test
        act = FakeAdminBot.plan[FakeAdminBot.cycles - 1]
        if act[0] == "clean":
            clock["t"] += act[1]           # connection stayed up act[1] seconds
            return                          # clean disconnect
        clock["t"] += 1.0                   # brief uptime before crash
        raise RuntimeError(act[1])

async def fake_sleep(s):
    sleeps.append(s)

g24 = {
    "__builtins__": __builtins__,
    "AdminBot": FakeAdminBot,
    "time": types.SimpleNamespace(monotonic=lambda: clock["t"]),
    "asyncio": types.SimpleNamespace(CancelledError=asyncio.CancelledError, sleep=fake_sleep),
}
mod24 = types.ModuleType("m24")
mod24.__dict__.update(g24)
code24 = ast.get_source_segment(src, get_func("run_admin_bot_forever"))
exec(compile(code24, SRC, "exec"), mod24.__dict__)
raf = mod24.__dict__["run_admin_bot_forever"]

# Scenario A: 3 quick clean drops then a long stable connection then clean drop
FakeAdminBot.cycles = 0; FakeAdminBot.plan = [("clean", 5), ("clean", 5), ("clean", 5), ("clean", 400)]
sleeps.clear()
try:
    asyncio.run(raf(None))
except SystemExit:
    pass
print(f"Scenario A (3 quick clean drops then stable 400s): sleeps={sleeps}")
assert sleeps == [20, 40, 80], sleeps      # backoff grows, NO sleep after stable uptime
# Backoff must NOT have been reset by quick clean drops (waits doubled each time)

# Scenario B: stable connection resets backoff (old healthy behavior preserved)
FakeAdminBot.cycles = 0; FakeAdminBot.plan = [("raise", "err1"), ("raise", "err2"), ("clean", 600), ("clean", 5)]
sleeps.clear()
try:
    asyncio.run(raf(None))
except SystemExit:
    pass
print(f"Scenario B (2 errors, stable 600s clean, then quick drop): sleeps={sleeps}")
assert sleeps == [20, 40, 20], sleeps      # 20,40 (errors) -> stable reset -> quick drop starts at 20 again

# Scenario C: pure exception path unchanged
FakeAdminBot.cycles = 0; FakeAdminBot.plan = [("raise", "e1"), ("raise", "e2"), ("raise", "e3")]
sleeps.clear()
try:
    asyncio.run(raf(None))
except SystemExit:
    pass
print(f"Scenario C (3 errors): sleeps={sleeps}")
assert sleeps == [20, 40, 80], sleeps

print("\nBUG-24: quick clean drops now back off (20/40/80...), stable uptime (>=300s) still resets backoff.")
