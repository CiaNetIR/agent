import ast, sys, hashlib

results = []

def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS" if ok else "FAIL"), "-", name, detail if not ok else "")

# ---------- T1: web_panel._verify_password (sha256 fallback, constant-time) ----------
import importlib.util, types, os, sys
# stub fastapi deps? web_panel imports fastapi... check availability
try:
    import fastapi  # noqa
    HAVE_FASTAPI = True
except ImportError:
    HAVE_FASTAPI = False

if HAVE_FASTAPI:
    # import web_panel for real is heavy (uvicorn, imports main?). _verify_password is pure.
    # Instead: ast-extract the function and exec with minimal globals.
    src = open("/home/z/cianet-review/web_panel.py", encoding="utf-8").read()
    tree = ast.parse(src)
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_verify_password")
    mod = ast.Module(body=[fn], type_ignores=[])
    g = {}
    exec(compile(mod, "<_verify_password>", "exec"), g)
    vp = g["_verify_password"]
    h = "sha256:" + hashlib.sha256("secret123".encode()).hexdigest()
    check("vp correct pw", vp("secret123", h) is True)
    check("vp wrong pw", vp("wrong", h) is False)
    check("vp empty hash", vp("x", "") is False)
    check("vp short hash sha256:abc", vp("x", "sha256:abc") is False)
    # tampered: flip one char
    bad = "sha256:" + ("0" if h[-1] != "0" else "1") + h[len("sha256:"):-1]
    check("vp tampered hash", vp("secret123", bad) is False)
    # non-ascii password
    h2 = "sha256:" + hashlib.sha256("رمز۱۲۳".encode("utf-8")).hexdigest()
    check("vp fa password", vp("رمز۱۲۳", h2) is True and vp("رمز۱۲۴", h2) is False)
else:
    # no fastapi: replicate semantics check purely by source inspection
    src = open("/home/z/cianet-review/web_panel.py", encoding="utf-8").read()
    check("vp uses compare_digest", "hmac.compare_digest(expected, actual)" in src and "zip(expected, actual)" not in src)

# ---------- T2: main._verify_last_2fa_password constant-time ----------
src = open("/home/z/cianet-review/main.py", encoding="utf-8").read()
tree = ast.parse(src)
fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_verify_last_2fa_password")
seg = ast.get_source_segment(src, fn)
check("2fa verify uses compare_digest", "hmac.compare_digest(expected, stored_hash)" in seg and "zip(" not in seg)
# behavior test with stubbed load_config
g = {"hashlib": hashlib, "hmac": __import__("hmac")}
stubs = {"cfg": {"acc1": {"last_2fa_hash": hashlib.sha256("acc1:pw".encode()).hexdigest(),
                          "last_2fa_hash_algo": "sha256_tagged"}}}
def load_config():
    return stubs["cfg"]
g["load_config"] = load_config
mod = ast.Module(body=[fn], type_ignores=[])
exec(compile(mod, "<v>", "exec"), g)
v = g["_verify_last_2fa_password"]
check("2fa verify tagged ok", v("acc1", "pw") is True)
check("2fa verify tagged bad", v("acc1", "nope") is False)
check("2fa verify wrong tag", v("accX", "pw") is False)
stubs["cfg"]["acc1"]["last_2fa_hash_algo"] = ""  # legacy unsalted
stubs["cfg"]["acc1"]["last_2fa_hash"] = hashlib.sha256("pw".encode()).hexdigest()
check("2fa verify legacy ok", v("acc1", "pw") is True)
check("2fa verify legacy bad", v("acc1", "x") is False)

# ---------- T3: wizard pop order (§20.10) ----------
tree = ast.parse(src)
# find WIZ_DEDICATED_EXTEND_DAYS branch in _handle_text_wizard (SaaSBot method)
def branch_info(state_name):
    for n in ast.walk(tree):
        if isinstance(n, ast.If) and isinstance(n.test, ast.Compare):
            c = n.test
            if isinstance(c.left, ast.Name) and c.left.id == "state" and isinstance(c.comparators[0], ast.Name) and c.comparators[0].id == state_name:
                pops = [x for x in ast.walk(n) if isinstance(x, ast.Call) and isinstance(x.func, ast.Attribute) and x.func.attr == "pop" and isinstance(x.func.value, ast.Attribute) and x.func.value.attr == "wizards"]
                # relative order: find the days int() validation try and pops
                return n, pops
    return None, []
n, pops = branch_info("WIZ_DEDICATED_EXTEND_DAYS")
check("WIZ_DEDICATED_EXTEND_DAYS found", n is not None)
if n:
    # collect top-level statements of the branch with line numbers
    stmts = n.body
    pop_lines = [s.lineno for s in stmts if isinstance(s, ast.Expr) and isinstance(s.value, ast.Call) and isinstance(s.value.func, ast.Attribute) and s.value.func.attr == "pop"]
    try_lines = [s.lineno for s in stmts if isinstance(s, ast.Try)]
    # pop must be AFTER the try (validation) at top level
    ok = len(pop_lines) == 1 and len(try_lines) >= 1 and pop_lines[0] > try_lines[0]
    # also the not-b branch pop exists inside an if
    check("extend_days pop after validation", ok, f"pops={pop_lines} tries={try_lines}")

n2, pops2 = branch_info("WIZ_DISCOUNT_APPLY_CODE")
check("WIZ_DISCOUNT_APPLY_CODE found", n2 is not None)
if n2:
    stmts = n2.body
    pop_lines = [s.lineno for s in stmts if isinstance(s, ast.Expr) and isinstance(s.value, ast.Call) and isinstance(s.value.func, ast.Attribute) and s.value.func.attr == "pop"]
    # last pop must come after the `if not new_amount.get("ok")` block (validation)
    val_if = None
    for s in stmts:
        if isinstance(s, ast.If) and isinstance(s.test, ast.UnaryOp) and isinstance(s.test.operand, ast.Call):
            f = s.test.operand.func
            if isinstance(f, ast.Attribute) and f.attr == "get":
                val_if = s.lineno
    check("discount pop after code validation", pop_lines and val_if and max(pop_lines) > val_if, f"pops={pop_lines} valif={val_if}")
    check("discount dead-path pops present", len(pop_lines) == 1, f"top-level pops={len(pop_lines)} (2 dead-path pops live inside ifs)")

# ---------- T4: §20.8 FloodWait branches ----------
for label, anchor in [("enemy_reply", "await event.reply(random.choice(ENEMY_REPLIES))"),
                      ("tracker_edit", 'await self.client.send_message("me", msg)'),
                      ("tracker_delete", 'await self.client.send_message("me", summary)')]:
    idx = src.find(anchor)
    ok = idx >= 0
    seg = src[idx:idx+800] if ok else ""
    check(f"{label} FloodWait branch", ok and "except errors.FloodWaitError as _fwe" in seg and "_flood_until = time.time() + _wait" in seg and "except Exception:" in seg)

# ---------- T5: §20.3 chmod sites in restore/rollback ----------
count = src.count("_chmod_private(dest)") + src.count("_chmod_private(sc_dest)")
check("restore/rollback chmod sites == 4", count == 4, f"count={count}")
check("workdir 0700", "_chmod_private(workdir, 0o700)" in src)
for pat in ["os.replace(tmp, dest)\n            # v2.14.2 (P2-10 / §20.3)", "os.replace(target, dest)"]:
    check(f"replace site present: {pat[:30]}", pat in src)

# ---------- T6: §20.15 session chmod ----------
check("session save chmod", "_chmod_private(os.path.join(self.sb.SESSIONS_DIR, f\"{tag}.session\"))" in src)

# ---------- T7: web_panel §20.7 ----------
wsrc = open("/home/z/cianet-review/web_panel.py", encoding="utf-8").read()
check("no raw loop.create_task remains", "loop.create_task(" not in wsrc)
check("enable uses _spawn_bg", 'm._spawn_bg(\n            m.ensure_started(tag, cfg[tag], caller="web_panel.enable"),' in wsrc)
check("disable uses _spawn_bg", 'm._spawn_bg(\n            m.ensure_stopped(tag, "web_panel.disable"),' in wsrc)

print()
fails = [r for r in results if not r[1]]
print(f"TOTAL: {len(results)} checks, {len(results)-len(fails)} PASS, {len(fails)} FAIL")
sys.exit(1 if fails else 0)
