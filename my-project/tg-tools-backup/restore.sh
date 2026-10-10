#!/usr/bin/env bash
# restore.sh — recover the Z watcher from this durable mirror (Scenario A).
# Usage: bash ~/my-project/tg-tools-backup/restore.sh [--no-start]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TG=/home/z/tg-tools
PY=/home/z/.venv/bin/python
SECRETS=/home/z/my-project/.secrets

echo "== Z restore from mirror =="
if [ ! -d "$HERE/code/watcher" ]; then
  echo "mirror missing ($HERE/code) — run refresh.sh or restore from a backup zip"
  exit 1
fi

# stop anything running (ignore errors)
bash "$TG/watcher/watcher_ctl.sh" stop >/dev/null 2>&1 || true
pkill -f "watcher\.py" >/dev/null 2>&1 || true
sleep 1

# rehydrate code
mkdir -p "$TG/watcher"
cp -r "$HERE/code/." "$TG/"
chmod +x "$TG"/*.py "$TG/watcher/"*.py "$TG/watcher/"*.sh 2>/dev/null || true
rm -f "$TG/watcher/watcher.lock" "$TG/watcher/supervisor.pid" \
      "$TG/watcher/PAUSE" "$TG/watcher/BACKUP_NOW" 2>/dev/null || true
echo "code restored."

# session check
if [ ! -f "$SECRETS/tg.env" ] || ! grep -q "TELEGRAM_SESSION_STRING=." "$SECRETS/tg.env" 2>/dev/null; then
  echo "!! SESSION MISSING: $SECRETS/tg.env has no TELEGRAM_SESSION_STRING."
  echo "   Restore secrets from the latest z_backup zip (secrets/tg.env),"
  echo "   or re-login: cd $TG && $PY login_phone.py"
  exit 2
fi
echo "session present."

# telethon check
if ! "$PY" -c "import telethon" >/dev/null 2>&1; then
  echo "installing telethon…"
  "$PY" -m pip install --quiet telethon || { echo "pip failed"; exit 3; }
fi

if [ "${1:-}" = "--no-start" ]; then
  echo "restored (--no-start). start with: $TG/watcher/watcher_ctl.sh start 15"
  exit 0
fi

echo "starting watcher…"
bash "$TG/watcher/watcher_ctl.sh" start 15
sleep 3
bash "$TG/watcher/watcher_ctl.sh" status
echo "done."
