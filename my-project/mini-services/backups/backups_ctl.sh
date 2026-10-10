#!/usr/bin/env bash
# backups_ctl.sh — control the 30-minute GitHub-backup service (:3010)
#   start | stop | restart | status | log [N] | run-now
set -u
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")"

sup_pid() { [ -f supervisor.pid ] && cat supervisor.pid 2>/dev/null; }
alive()   { p="$1"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

case "${1:-help}" in
  start)
    if p="$(sup_pid)" && alive "$p"; then
      echo "already running (supervisor pid $p)"
      exit 0
    fi
    rm -f supervisor.pid
    setsid --fork bash supervisor.sh >/dev/null 2>&1 </dev/null
    sleep 2
    echo "started (supervisor pid $(sup_pid 2>/dev/null || echo '?'))"
    ;;
  stop)
    p="$(sup_pid)"
    [ -n "$p" ] && kill "$p" 2>/dev/null && echo "supervisor $p killed"
    # kill ONLY this service's `bun index.ts` (the agent service on :3004 runs
    # the same cmdline — match by cwd so we never take it down too)
    for pid in $(pgrep -f "bun index[.]ts" 2>/dev/null); do
      [ "$(readlink -f /proc/$pid/cwd 2>/dev/null)" = "$PWD" ] && kill "$pid" 2>/dev/null && echo "service pid $pid killed"
    done
    rm -f supervisor.pid
    echo "stopped"
    ;;
  restart)
    "$SELF" stop; sleep 1; "$SELF" start
    ;;
  status)
    p="$(sup_pid)"
    if [ -n "$p" ] && alive "$p"; then
      echo "supervisor: $p (alive)"
    else
      echo "supervisor: not running"
    fi
    if curl -s -m 3 http://127.0.0.1:3010/healthz >/dev/null 2>&1; then
      echo "http :3010 — healthy"
    else
      echo "http :3010 — no answer"
    fi
    [ -f state.json ] && python3 -c "import json;s=json.load(open('state.json'));print('lastRun:',s.get('lastRunAt'));print('lastOk:',s.get('lastOkAt'));print('lastCommit:',(s.get('lastCommit') or '')[:12]);print('lastError:',s.get('lastError'))"
    ;;
  log)
    N="${2:-30}"
    tail -n "$N" backup.log 2>/dev/null || echo "(no log yet)"
    ;;
  run-now)
    KEY="$(grep -oP 'PANEL_PASSWORD_SHA256=\K[0-9a-f]+' /home/z/my-project/.secrets/panel.env)"
    curl -s -X POST -H "x-panel-key: $KEY" http://127.0.0.1:3010/run && echo
    ;;
  *)
    echo "usage: $0 start|stop|restart|status|log [N]|run-now"
    ;;
esac
