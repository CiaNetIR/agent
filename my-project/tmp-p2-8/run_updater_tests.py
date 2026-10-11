"""P2-8 verification tests for cianet_updater.py — §14.4 legacy path, §20.13 pinned SHA,
§14.3 lock file mode, rollback ordering (mixed-state matrix)."""
import json
import os
import shutil
import stat
import subprocess
import sys

BASE = "/tmp/p28_updater_test"
shutil.rmtree(BASE, ignore_errors=True)
os.makedirs(BASE + "/home")
REMOTE = BASE + "/remote.git"
WORK = BASE + "/repo"

ENV = dict(os.environ, HOME=BASE + "/home",
           GIT_CONFIG_GLOBAL=BASE + "/home/.gitconfig")
ENV.pop("CIANET_MIN_COMMIT", None)

def run(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=ENV)
    assert r.returncode == 0, (cmd, r.stderr)
    return r

def commit_all(cwd, msg):
    run(["git", "add", "-A"], cwd=cwd)
    run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", msg], cwd=cwd)

# ── bare remote + v1 (good) ──
run(["git", "init", "--bare", "-b", "main", REMOTE])
os.makedirs(WORK)
open(WORK + "/main.py", "w").write("print('main v1')\n")
open(WORK + "/web_panel.py", "w").write("print('panel v1')\n")
open(WORK + "/requirements.txt", "w").write("# empty\n")
open(WORK + "/cianet_updater.py", "w").write("# placeholder\n")
run(["git", "init", "-b", "main"], cwd=WORK)
commit_all(WORK, "v1")
V1 = subprocess.run(["git", "rev-parse", "HEAD"], cwd=WORK,
                    capture_output=True, text=True, env=ENV).stdout.strip()
run(["git", "remote", "add", "origin", REMOTE], cwd=WORK)
run(["git", "push", "origin", "main"], cwd=WORK)

# ── v2 (good) on remote ──
NEW = BASE + "/newrepo"
run(["git", "clone", REMOTE, NEW], cwd=BASE)
open(NEW + "/main.py", "w").write("print('main v2')\n")
open(NEW + "/web_panel.py", "w").write("print('panel v2')\n")
commit_all(NEW, "v2")
run(["git", "push", "origin", "main"], cwd=NEW)
V2 = subprocess.run(["git", "rev-parse", "HEAD"], cwd=NEW,
                    capture_output=True, text=True, env=ENV).stdout.strip()

os.environ["CIANET_INSTALL_DIR"] = WORK
os.environ["CIANET_BRANCH"] = "main"
os.environ.update(HOME=BASE + "/home", GIT_CONFIG_GLOBAL=BASE + "/home/.gitconfig")
os.environ.pop("CIANET_MIN_COMMIT", None)
sys.path.insert(0, WORK)
sys.path.insert(0, "/home/z/cianet-review")
import cianet_updater

real_run = subprocess.run
GIT_CALLS = []
def spy(cmd, *a, **kw):
    try:
        if cmd and cmd[0] == "git":
            GIT_CALLS.append(list(cmd))
        if cmd and "systemctl" in " ".join(str(c) for c in cmd[:2]):
            return subprocess.CompletedProcess(cmd, 0, "", "faked")
    except Exception:
        pass
    return real_run(cmd, *a, **kw)
subprocess.run = spy
try:
    # ═══ TEST A (§14.4): CIANET_MIN_COMMIT unset → LEGACY origin/BRANCH reset ═══
    print("═══ TEST A (§14.4 legacy): unset → git reset --hard origin/main ═══")
    os.environ.pop("CIANET_MIN_COMMIT", None)
    GIT_CALLS.clear()
    ok, msg = cianet_updater.apply_update(restart=True)
    assert ok is True, msg
    resets = [c for c in GIT_CALLS if c[1:3] == ["reset", "--hard"]]
    print("reset argv:", resets)
    assert resets and resets[0][3] == "origin/main", \
        "legacy path must reset to origin/BRANCH, got: %r" % (resets,)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=WORK,
                          capture_output=True, text=True, env=ENV).stdout.strip()
    assert head == V2, "HEAD must be remote tip after legacy reset"
    print("HEAD == V2 (%s) — legacy path preserved" % head[:8])
    print("TEST A PASS")

    # ═══ TEST B (§20.13/§14.1): CIANET_MIN_COMMIT set → pinned-SHA reset ═══
    print("═══ TEST B (§20.13): min_commit set → reset --hard <verified SHA> ═══")
    run(["git", "reset", "--hard", V1], cwd=WORK)
    os.environ["CIANET_MIN_COMMIT"] = V1  # v1 is ancestor of remote v2 → allowed
    GIT_CALLS.clear()
    ok, msg = cianet_updater.apply_update(restart=True)
    assert ok is True, msg
    resets = [c for c in GIT_CALLS if c[1:3] == ["reset", "--hard"]]
    print("reset argv:", resets)
    assert resets and resets[0][3] == V2, \
        "pinned path must reset to the verified SHA (%s), got: %r" % (V2[:8], resets)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=WORK,
                          capture_output=True, text=True, env=ENV).stdout.strip()
    assert head == V2, "HEAD must equal verified SHA (post-reset re-check)"
    print("reset target = verified SHA, HEAD == SHA")
    print("TEST B PASS")

    # ═══ TEST C (supply-chain rollback attack): remote older than min → REFUSED ═══
    print("═══ TEST C: remote force-pushed BELOW min_commit → refused ═══")
    run(["git", "reset", "--hard", V1], cwd=WORK)
    run(["git", "push", "-f", "origin", V1 + ":main"], cwd=NEW)
    os.environ["CIANET_MIN_COMMIT"] = V2  # min = v2, remote now = v1 (older)
    GIT_CALLS.clear()
    ok, msg = cianet_updater.apply_update(restart=True)
    print("ok:", ok, "| msg:", msg.splitlines()[0])
    assert ok is False, "rollback attack must be refused"
    assert "Supply chain" in msg or "NOT a descendant" in msg, msg
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=WORK,
                          capture_output=True, text=True, env=ENV).stdout.strip()
    assert head == V1, "local HEAD must be untouched when refused"
    print("refused + HEAD untouched")
    print("TEST C PASS")
finally:
    subprocess.run = real_run
    os.environ.pop("CIANET_MIN_COMMIT", None)

# ═══ TEST D (§14.3): lock file mode 0600 + PID liveness + release ═══
print("═══ TEST D (§14.3): /tmp/cianet-update.lock created 0600, live-PID honored ═══")
assert not cianet_updater.LOCK_FILE.exists(), "lock must be released after apply_update"
orig_release = cianet_updater._release_lock
cianet_updater._release_lock = lambda: None  # hold it so we can inspect
try:
    assert cianet_updater._acquire_lock(timeout=1) is True
    mode = stat.S_IMODE(os.stat(str(cianet_updater.LOCK_FILE)).st_mode)
    pid = cianet_updater.LOCK_FILE.read_text().strip()
    print("lock mode: %o | pid: %s (is-self=%s)" % (mode, pid, pid == str(os.getpid())))
    assert mode == 0o600, "lock mode must be 0600, got %o" % mode
    assert pid == str(os.getpid()), "lock must contain the holding PID"
    assert cianet_updater._acquire_lock(timeout=1) is False, "live-PID lock must not be stolen"
finally:
    cianet_updater._release_lock = orig_release
    orig_release()
print("TEST D PASS")

# ═══ TEST E (BUG-18b rollback ordering): broken main + good web_panel ═══
print("═══ TEST E: broken main.py + GOOD web_panel.py → consistent old pair restored ═══")
os.environ.pop("CIANET_MIN_COMMIT", None)
run(["git", "reset", "--hard", V1], cwd=WORK)
open(NEW + "/main.py", "w").write("def broken(:\n")
open(NEW + "/web_panel.py", "w").write("print('panel v3')\n")
commit_all(NEW, "v3 broken main, good panel")
run(["git", "push", "-f", "origin", "main"], cwd=NEW)
ok, msg = cianet_updater.apply_update(restart=False)
print("ok:", ok, "| first line:", msg.splitlines()[0])
assert ok is False
assert "main.py" in msg
assert open(WORK + "/main.py").read() == "print('main v1')\n", "main.py restored from backup"
assert open(WORK + "/web_panel.py").read() == "print('panel v1')\n", \
    "web_panel.py also restored to pre-reset commit (consistent pair)"
state = json.load(open(WORK + "/data/.updater_state.json"))
assert state["rolled_back"] is True
print("main.py <- backup, web_panel.py <- pre_reset_commit (consistent old pair)")
print("TEST E PASS")

print("ALL P2-8 UPDATER TESTS PASS")
