# @VpnStarZ Watcher — 7-day AI auto-responder (v4)

Restored 2026-10-07 after full sandbox reset wiped v1. Session + credentials
now live in the DURABLE location `/home/z/my-project/.secrets/`
(survive sandbox resets — my-project is the only persistent volume):
- `tg.env` — session string + API credentials
- `watcher-config.json` — blacklist + standing instructions

## v4 features (owner requests, 2026-10-07 evening)
- HUMAN persona: typed like a real Persian shop admin (no ZWNJ, short
  casual bubbles, no robotic سلام-opener, mirrors the customer's tone).
- PRICES updated per owner instruction: unlimited 399k T/month,
  volume 15k T/GB (baked into the base persona).
- FOOTER replaced per owner instruction — every bot message now ends with:
  «من یک دستیار هوش مصنوعی هستم. پشتیبانی آفلاین است.»
  (is_bot_own_text accepts the old footer too, for history classification)
- Saved Messages command channel — multi-action commands, e.g.:
  * «جواب اینا رو نده @x @y» → blacklist add (resolves ids live)
  * «جواب بده به @x» → blacklist remove
  * «به @x بگو ...» → send DM from the account (with footer)
  * «وضعیت» → live status report
  * «از این بعد همیشه ...» → standing instruction for all replies
  * «بکاپ بگیر» → full self-backup zip sent to Saved Messages
  * «به همه بگو ...» → broadcast to recent customers (asks «بله»
    confirmation first; 6-10 s gaps, cap 50, flood-aware)
  * anything else → Z chats back
- AUTO-BACKUP: every blacklist/instruction change sends a fresh backup
  zip to Saved Messages (throttled 1/h).
- Service accounts (777000 Telegram, @telegram) never get replies.
- 2FA-reset related commands refused (DANGER_RE).
- Commands missed during downtime recovered by catchup (last_sm_id guard).

## Layout
- `watcher.py` — event-driven Telethon daemon (the ONLY live connection)
- `supervisor.sh` — keeps it alive; PAUSE-aware; exits at 7-day expiry
- `watcher_ctl.sh` — start / pause / resume / stop / status / expiry / log
- `../login_phone.py` — send-code / complete / status (fresh logins)
- `../inspect_dms.py` — see recent DMs + unanswered ones (read-only)
- `../overview_dms.py` — last-message overview of all user DMs
- `../poll_chat.py`, `../send_dm.py` — manual tools
- `state.json` — 7-day window + counters + last_sm_id (atomic)
- `wlog.jsonl` — rotating JSONL log (5 MB)

## Every reply carries the mandatory footer (appended by code, not LLM):
من یک دستیار هوش مصنوعی هستم. پشتیبانی آفلاین است.

## Session-safety rules (NEVER break)
1. ONE client at a time on the session: watcher OR manual tools — never both.
   Manual work = `./watcher_ctl.sh pause` → do work → `./watcher_ctl.sh resume`.
2. Never delete the session string in `.secrets/tg.env`. It is the account.
3. Never touch the production selfbot session (`/opt/cianet`).
4. Never interact with 2FA-reset confirmations (tfago:/abok: buttons).

## Operations
```bash
cd /home/z/tg-tools/watcher
./watcher_ctl.sh start 15      # deploy, catchup last 15 min of missed DMs
./watcher_ctl.sh status        # processes + state
./watcher_ctl.sh log 50        # last 50 events
./watcher_ctl.sh pause         # free the session for manual tools
./watcher_ctl.sh resume 5
./watcher_ctl.sh stop          # full stop
./watcher_ctl.sh expiry        # remaining days of the window
```

## Exit codes (watcher.py)
0 pause · 3 no/dead session (supervisor retries 30 s) · 4 duplicate guard
· 42 window expired (supervisor exits) · other crash → backoff 30→600 s

## If the sandbox resets again
1. `uv pip install --python /home/z/.venv/bin/python telethon`
2. Check `/home/z/my-project/.secrets/tg.env` — session survives there.
3. Recreate `/home/z/tg-tools/` (scripts) if wiped, then
   `watcher_ctl.sh start 30` — catchup covers the outage gap.
No new login code is needed unless the string is missing.
