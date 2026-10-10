#!/usr/bin/env bash
# supervisor.sh — keep the userspace sshd alive forever (tunnel-supervisor pattern)
set -u
cd "$(dirname "$0")"
echo $$ > supervisor.pid
backoff=2
while true; do
  ./run.sh >> service.log 2>&1
  rc=$?
  echo "[sshd-supervisor] run.sh exited rc=$rc; restart in ${backoff}s" >> service.log
  sleep "$backoff"
  backoff=$((backoff * 2))
  if [ "$backoff" -gt 30 ]; then backoff=30; fi
done
