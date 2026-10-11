---
Task ID: T3
Agent: general-purpose (loop/auto-reply tests)
Task: PHASE 3 — runtime-test the FLAGSHIP wiring (BUG-1) in CiaNet v2.14.2: scheduled-message
loop (spawn + loop-body corrections + FloodWait branch), SelfBot._on_incoming auto-reply block
(incl. FLOW-4 tg_user_id candidate), and the _SCHEDULED_MESSAGE_LOOP_TASK spawn guard. No repo
modifications; tests under /tmp/t3.

Work Log:
- Read CIANET_RULES_AND_POLICIES.md §10 (FloodWait coordination `time.time()+seconds+2` + sleep,
  §10.4 _spawn_bg, §10.5 singleton pattern) and §15 (bg-task strong refs, _safe_handler) in full.
- Read worklog.md 0-PLAN + P1-4 (BUG-1 wiring: spawn site, 2 loop-body corrections, _on_incoming
  placement between enemy and silence blocks) + P2-4 (verification details: entry.bot.client
  access path, None-return retry, id-space proof) + 2-ORCH (FLOW-3B, FLOW-4 tg_user_id candidate
  loop, scheduled-loop FloodWait §20.8 coordination).
- Copied repo → /tmp/t3/repo (cmp-verified byte-identical to /home/z/cianet-review/main.py at test
  time; zero writes to the review tree).
- Harness design (/tmp/t3/test_loops.py, /tmp/t3/stubs/):
  - telethon stub package shadows the venv's real telethon (sys.path order): TelegramClient,
    Button (metaclass: any attr → callable; explicit inline() so main's inspect.signature probe
    works), events (NewMessage + lazy attrs), errors (RPCError; FloodWaitError with .seconds,
    constructible as FloodWaitError(seconds=3); cached lazy classes for getattr-tolerated names),
    tl.functions.*/tl.types.* request/type names, sessions/password. Read main.py's import block
    and stubbed exactly those symbols; argon2/cryptography/uvicorn are lazy imports — not needed.
  - SELFBOT_DATA_DIR=/tmp/t3/data (wiped each run) set BEFORE importing main so module-level
    db_init_db()/init_db() run against a temp DB; main.py imports cleanly with stubs (verified).
  - Loop single-cycle driver: main.asyncio replaced by a delegating proxy whose sleep() is a
    recorder (delays list + call counter, safety valve) that raises a StopCycle(BaseException)
    sentinel on the 60s cycle-tail sleep → ends `while True` after exactly one cycle without the
    loop's `except Exception` able to eat it; proxy restored in finally. Cycle stdout captured
    (redirect_stdout) so tests assert no '⚠️' error was silently swallowed by internal handlers.
  - ACCOUNTS populated with real RunningAccount + real SelfBot(tag, cfg) instances (never start()):
    sb.client = FakeClient() (records send/delete/read ops in order), my_id set, all other
    features explicitly OFF for isolation (enabled=False, enemies={}, login_code_guard=False,
    _login_code_armed_until=0, silence_all=False, auto_read_*=False, _flood_until=0.0).
  - DB seeded directly (scheduled_messages / auto_replies) via main's own _conn() helpers using
    main._now() format; due=past-1h, not-due=+1h ISO strings (lexicographic compare matches loop).
  - Spawn guard: AST-extract the real spawn `if` block from async def main() → static assertions
    (global stmt before block, None/done guard, `not IS_DEDICATED_BOT`, _spawn_bg(
    _scheduled_message_loop()), after _EMBED_PANEL_TASK block, before argv dispatch, exactly one
    spawn assignment in main()) + dynamic: exec the compiled block in main.__dict__ 4× with a
    stubbed _spawn_bg recorder (None→spawn; running task→no double-spawn; done task→respawn;
    IS_DEDICATED_BOT=True→never) — module globals restored after. Plus real _spawn_bg strong-ref
    test (task in _BG_TASKS, result delivered, done-callback removes it).
- Found + fixed 2 harness bugs mid-run (not repo bugs): t3 registered a RunningAccount as `bot`
  (double wrap → AttributeError 'RunningAccount' object has no attribute 'client' — exposed the
  need for log-capture assertions, now added); t7a looked for the `global` stmt inside the if
  block while main.py correctly places it immediately before it.
- Ran suite 3× from clean state: deterministic 62/62 PASS each run (exit 0).

Stage Summary:
- Matrix results — ALL PASS (62/62 checks; groups: loop 30/30, auto-reply 16/16, spawn 16/16):
  1. Loop single cycle (due row): send_message called exactly once with (chat_id, text) via
     entry.bot.client.send_message, row → sent=1, one clean tail sleep(60), no swallowed errors.
  2. Not-due row (future scheduled_at): no send, stays sent=0.
  3. Offline accounts (all 3 variants in one cycle — tag missing from ACCOUNTS, bot=None,
     client=None): rows untouched, no crash, loop continued to a 4th online row and sent it.
  4. FloodWait branch (§20.8/§10.1): FloodWaitError(seconds=3) → sleep recorded exactly 5s
     (3+2 grace), entry.bot._flood_until set to ~now+5, cycle breaks out (no more sends), row
     stays sent=0 for retry, no exception escapes, coordination print logged.
  5. None-return retry: gate-skip send (None) → row NOT marked sent, loop continues to the next
     due row (processed + marked) — continue-not-abort proven.
  6. Auto-reply wiring in _on_incoming: keyword "سلام" (row user_id == cfg owner_user_id) → reply
     sent via client.send_message with no delete/read/enemy side effects; sender 777000 → no
     reply; sender == my_id → no reply; empty + whitespace text → no reply; _flood_until in
     future → gated (and fires once expired — guard is the only blocker); FLOW-4 tg_user_id
     candidate (owner_user_id=None, tg_user_id=5555, row user_id=5555) → reply fires, foreign-uid
     row (7777) does NOT; owner-uid scoping (row of other user) → no cross-tenant leak; bonus:
     FloodWait during reply send → coordinated (_flood_until ~now+5), no raise; bonus: silenced
     chat still gets reply and send happens BEFORE silence-delete (P1-4 ordering); bonus: enabled
     =False does not block auto-reply (by design — panel-sold feature).
  7. Spawn guard: static (block in main() with global stmt, §20.7 None/done guard, dedicated-bot
     gate, _spawn_bg spawn, after embed-panel/before argv dispatch, single spawn site) + dynamic
     (2nd main() call does NOT double-spawn while task running; done() task respawns;
     IS_DEDICATED_BOT child never spawns) + _spawn_bg strong-ref/no-leak.
- Failures: 0 in final runs (2 intermediate failures were harness bugs, fixed; details above).
- Observations (informational, no action needed): (a) FLOW-4 candidate loop means an account with
  BOTH owner_user_id=None AND tg_user_id=None gets NO auto-reply even if a tag-scoped row exists —
  the old tag-scope fallback for fully-orphan accounts is gone; this is the safer behavior (rows
  can only belong to a panel user, and an orphan account has no owner) — noted as intentional;
  (b) pre-existing (untouched, matches P2-4 note): LIMIT 20 head-of-line blocking for permanently
  failing due rows.
- Artifacts: /tmp/t3/test_loops.py (suite), /tmp/t3/stubs/ (telethon stub), /tmp/t3/repo (snapshot),
  /tmp/t3/data (temp DB). Repo untouched (cmp identical; no writes to /home/z/cianet-review).
---
