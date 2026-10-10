#!/usr/bin/env bash
# supervisor.sh — keeps watcher.py alive for the whole 7-day window.
#   PAUSE file  -> watcher exits 0, supervisor waits (no backoff growth)
#   exit 42     -> 7-day window expired -> supervisor exits permanently
#   exit 3      -> session missing/dead -> retry every 30 s (login in progress)
#   exit 4      -> duplicate instance   -> retry every 30 s
#   other       -> true crash -> backoff 30 s doubling up to 600 s
set -u
cd "$(dirname "$0")"
PY=/home/z/.venv/bin/python
echo $$ > supervisor.pid
backoff=5

is_expired() {
  "$PY" - <<'EOF'
import json, time, sys
try:
    s = json.load(open("state.json"))
except Exception:
    sys.exit(1)
sys.exit(0 if time.time() > s.get("window_end", 0) else 1)
EOF
}

while true; do
  if [ -f PAUSE ]; then
    sleep 5
    backoff=5
    continue
  fi
  if is_expired; then
    echo "[supervisor] 7-day window expired — permanent exit"
    rm -f supervisor.pid
    exit 0
  fi
  "$PY" watcher.py --catchup-minutes "$(cat catchup.txt 2>/dev/null || echo 15)" >> wstdout.log 2>&1
  rc=$?
  case $rc in
    0)  echo "[supervisor] watcher paused-exited (rc=0); holding"
        backoff=5 ;;
    42) echo "[supervisor] watcher expired (rc=42); permanent exit"
        rm -f supervisor.pid; exit 0 ;;
    3|4) echo "[supervisor] watcher rc=$rc (session/duplicate); retry in 30s"
        sleep 30; backoff=5; continue ;;
    *)  echo "[supervisor] watcher crashed rc=$rc; backoff ${backoff}s"
        backoff=$((backoff * 2)); [ "$backoff" -gt 600 ] && backoff=600 ;;
  esac
  sleep "$backoff"
done
