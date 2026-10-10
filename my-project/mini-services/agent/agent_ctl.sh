#!/usr/bin/env bash
# agent_ctl.sh — control the Z agent core service (:3004)
#   start | stop | restart | status | log [N]
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
    pkill -f "bun index[.]ts" 2>/dev/null && echo "agent killed"
    rm -f supervisor.pid
    echo "stopped"
    ;;
  restart)
    "$SELF" stop; sleep 1; "$SELF" start
    ;;
  status)
    p="$(sup_pid)"
    echo "supervisor: $(alive "$p" && echo "RUNNING pid $p" || echo down)"
    if alive "$p"; then
      echo "port 3004: $(curl -s -m 3 http://localhost:3004/healthz || echo fail)"
    fi
    ;;
  log)
    tail -n "${2:-30}" service.log
    ;;
  *)
    sed -n '2,5p' "$0"
    ;;
esac
