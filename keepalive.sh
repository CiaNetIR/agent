#!/bin/bash
LOG=/home/z/keepalive.log
say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
say "keepalive started (pid $$)"
while true; do
  curl -s -m 6 -o /dev/null http://localhost:3000/ || { pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 3; rm -rf /home/z/my-project/.next; setsid --fork bash -c 'cd /home/z/my-project && exec bun run dev' </dev/null >/dev/null 2>&1; }
  curl -s -m 5 http://localhost:3004/healthz >/dev/null 2>&1 || bash /home/z/my-project/mini-services/agent/agent_ctl.sh start >>"$LOG" 2>&1
  curl -s -m 5 -o /dev/null http://localhost:3001/ || bash /home/z/my-project/mini-services/terminal/term_ctl.sh start >>"$LOG" 2>&1
  pgrep -f "watcher.py" >/dev/null || (cd /home/z/tg-tools/watcher && bash watcher_ctl.sh start) >>"$LOG" 2>&1
  sleep 60
done
