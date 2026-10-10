#!/usr/bin/env bash
# supervisor.sh — keep the cloudflared connector alive forever
# (structure cloned from mini-services/monitor/supervisor.sh).
# Started detached via setsid --fork from tunnel_ctl.sh.
set -u
cd "$(dirname "$0")"
echo $$ > supervisor.pid
backoff=2
while true; do
  /home/z/my-project/mini-services/tunnel/tunnel-run.sh >> service.log 2>&1
  rc=$?
  echo "[tunnel-supervisor] tunnel-run exited rc=$rc; restart in ${backoff}s" >> service.log
  # rc=1 before provisioning just means "no token yet" — keep backing off;
  # the watcher provisions and the next restart picks the token file up.
  sleep "$backoff"
  backoff=$((backoff * 2))
  if [ "$backoff" -gt 60 ]; then backoff=60; fi
done
