# P2-3 BUG-14 logic verification — replicates the edited wizard block exactly
import sqlite3, sys

DB = "/home/z/my-project/tmp-p2-3/test.db"
conn = sqlite3.connect(DB)
conn.execute("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, discount_code TEXT, discount_percent INT, amount_toman INT, amount_usdt REAL, original_amount_toman INT)")
conn.execute("CREATE TABLE IF NOT EXISTS discount_codes (code TEXT PRIMARY KEY, used_count INT)")
conn.execute("DELETE FROM orders"); conn.execute("DELETE FROM discount_codes")
conn.execute("INSERT INTO orders VALUES (1, NULL, NULL, 100000, 10.0, NULL)")
conn.execute("INSERT INTO discount_codes VALUES ('SAVE10', 1)")  # apply_discount_code already burned +1
conn.commit()

class Ctx:
    def __init__(self, fail): self.fail = fail
    def __enter__(self): return self
    def __exit__(self, *a):
        if self.fail:
            conn.rollback()  # real sqlite ctx manager rolls back the tx
            raise sqlite3.OperationalError("disk I/O error")
        conn.commit(); return False
    def execute(self, sql, params=()):
        conn.execute(sql, params)
        if not self.fail: conn.commit()

def _conn_immediate_factory(fail):
    def _ci(f=None): return Ctx(fail if f is None else f)
    return _ci

class Resp:
    def __init__(self, fail=False): self.msgs = []; self.fail = fail
    async def respond(self, m): 
        if self.fail: raise RuntimeError("telegram send failed (FloodWait)")
        self.msgs.append(m)

import asyncio
printed = []
def print(*a, **k): printed.append(" ".join(str(x) for x in a))

def used_count(): return conn.execute("SELECT used_count FROM discount_codes WHERE code='SAVE10'").fetchone()[0]
def order_code(): return conn.execute("SELECT discount_code FROM orders WHERE id=1").fetchone()[0]

async def run(update_fails, respond_fails):
    conn.execute("UPDATE orders SET discount_code=NULL"); conn.execute("UPDATE discount_codes SET used_count=1"); conn.commit()
    event = Resp(respond_fails)
    code, oid = "SAVE10", 1
    new_amount = {"percent": 10, "amount": 90000}
    order = {"amount_toman": 100000, "amount_usdt": 10.0}
    _conn_immediate = _conn_immediate_factory(update_fails)
    # === verbatim structure of the edited block ===
    _order_saved = False
    try:
        with _conn_immediate() as c:
            c.execute(
                "UPDATE orders SET discount_code = ?, discount_percent = ?, "
                "amount_toman = ?, amount_usdt = ?, original_amount_toman = ? "
                "WHERE id = ?",
                (code, new_amount["percent"], new_amount["amount"],
                 round(order["amount_usdt"] * (100 - new_amount["percent"]) / 100, 2),
                 int(order["amount_toman"]), oid),
            )
        _order_saved = True
        await event.respond("✅ تخفیف اعمال شد ...")
    except Exception as _e:
        if not _order_saved:
            try:
                with _conn_immediate(False) as c:  # rollback tx never fails in test
                    c.execute(
                        "UPDATE discount_codes SET used_count = MAX(0, used_count - 1) "
                        "WHERE code = ? AND used_count > 0",
                        (code,),
                    )
            except Exception as _rb:
                print(f"⚠️ [discount_apply] rollback used_count failed: {_rb}")
        print(f"❌ [discount_apply] error (order_saved={_order_saved}): {type(_e).__name__}: {_e}")
        if not event.fail:
            await event.respond("❌ خطا در اعمال تخفیف — لطفاً دوباره تلاش کن.")
        else:
            # second respond also fails -> propagates to outer wizard handler (pre-existing behavior)
            pass
    return event

# Scenario 1: UPDATE fails -> rollback fires (used_count 1 -> 0), order untouched, generic msg
r = asyncio.run(run(update_fails=True, respond_fails=False))
assert used_count() == 0, "S1 rollback failed"
assert order_code() is None, "S1 order should not be updated"
assert any("خطا در اعمال تخفیف" in m for m in r.msgs) and not any("disk I/O" in m for m in r.msgs), "S1 msg"
assert any("order_saved=False" in p for p in printed), "S1 log"

# Scenario 2: UPDATE ok, respond ok -> NO rollback, success msg
r = asyncio.run(run(update_fails=False, respond_fails=False))
assert used_count() == 1, "S2 used_count must stay 1 (burned by apply)"
assert order_code() == "SAVE10", "S2 order updated"
assert any("تخفیف اعمال شد" in m for m in r.msgs), "S2 msg"

# Scenario 3: UPDATE ok, respond FAILS -> NO rollback (the P2-3 correction), error msg attempt
r = asyncio.run(run(update_fails=False, respond_fails=True))
assert used_count() == 1, "S3 MUST NOT rollback when UPDATE committed (old code rolled back!)"
assert order_code() == "SAVE10", "S3 order stays updated"
assert any("order_saved=True" in p for p in printed), "S3 log shows saved=True"

print("ALL 3 SCENARIOS PASS")
