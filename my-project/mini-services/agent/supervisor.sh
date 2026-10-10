#!/usr/bin/env bash
# supervisor.sh — keep the agent core (:3004) alive forever.
# Started detached via setsid --fork (watcher-proven pattern).
set -u
cd "$(dirname "$0")"
echo $$ > supervisor.pid
backoff=2
while true; do
  bun index.ts >> service.log 2>&1
  rc=$?
  echo "[agent-supervisor] bun exited rc=$rc; restart in ${backoff}s" >> service.log
  sleep "$backoff"
  backoff=$((backoff * 2)); [ "$backoff" -gt 60 ] && backoff=60
done
