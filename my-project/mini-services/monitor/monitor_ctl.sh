#!/usr/bin/env bash
# monitor_ctl.sh — control the API monitor daemon (mini-services/monitor)
#   start | stop | restart | status | log [N]
# NOTE: the stop pkill pattern "monitor[.]py" can never match the Telegram
# watcher (watcher.py) or any other service — it only matches this daemon.
set -u
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")"
STATE="/home/z/agent-files/api-monitor-state.json"

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
    pkill -f "monitor[.]py" 2>/dev/null && echo "monitor killed"
    rm -f supervisor.pid
    echo "stopped"
    ;;
  restart)
    "$SELF" stop; sleep 1; "$SELF" start
    ;;
  status)
    p="$(sup_pid)"
    echo "supervisor: $(alive "$p" && echo "RUNNING pid $p" || echo down)"
    if pgrep -f "mini-services/monitor/monitor[.]py" >/dev/null; then
      echo "monitor.py: RUNNING pid $(pgrep -f 'mini-services/monitor/monitor[.]py' | head -1)"
    else
      echo "monitor.py: down"
    fi
    if [ -r "$STATE" ]; then
      echo "state: $(jq -c '{aliveAt,startedAt,activated,fingerprint,lastPingOk,lastPingStatus,failCount,alertedDown}' "$STATE" 2>/dev/null)"
      aliveAt=$(jq -r '.aliveAt // 0' "$STATE" 2>/dev/null)
      nowMs=$(date +%s%3N)
      [ -n "$aliveAt" ] && [ "$aliveAt" -gt 0 ] 2>/dev/null && \
        echo "heartbeat age: $(( (nowMs - aliveAt) / 1000 ))s (panel treats >180s as dead)"
    else
      echo "state: no state file yet"
    fi
    ;;
  log)
    tail -n "${2:-30}" service.log
    ;;
  *)
    sed -n '2,5p' "$0"
    ;;
esac
