#!/usr/bin/env bash
# supervisor.sh — keep the terminal service alive forever.
# Started detached via watcher-proven pattern: setsid --fork
set -u
cd "$(dirname "$0")"
echo $$ > supervisor.pid
backoff=2
while true; do
  node index.mjs >> service.log 2>&1
  rc=$?
  echo "[term-supervisor] node exited rc=$rc; restart in ${backoff}s" >> service.log
  sleep "$backoff"
  backoff=$((backoff * 2)); [ "$backoff" -gt 60 ] && backoff=60
done
