#!/usr/bin/env bash
# supervisor.sh — keep the API monitor daemon alive forever.
# Started detached via setsid --fork (watcher-proven pattern).
set -u
cd "$(dirname "$0")"
echo $$ > supervisor.pid
backoff=2
while true; do
  /home/z/.venv/bin/python /home/z/my-project/mini-services/monitor/monitor.py >> service.log 2>&1
  rc=$?
  echo "[monitor-supervisor] python exited rc=$rc; restart in ${backoff}s" >> service.log
  sleep "$backoff"
  backoff=$((backoff * 2)); [ "$backoff" -gt 60 ] && backoff=60
done
