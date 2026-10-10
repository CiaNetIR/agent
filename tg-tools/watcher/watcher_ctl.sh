#!/usr/bin/env bash
# watcher_ctl.sh — control the 7-day @VpnStarZ AI watcher.
#   start [catchup-minutes]   deploy (setsid, survives command end)
#   pause                      watcher exits; session free for manual tools
#   resume [catchup-minutes]   continue after pause
#   stop                       kill supervisor + watcher completely
#   status                     processes, state, last log lines
#   expiry                     remaining time of the 7-day window
#   log [N]                    last N log events (default 30)
set -u
cd "$(dirname "$0")"
PY=/home/z/.venv/bin/python

sup_pid()  { [ -f supervisor.pid ] && cat supervisor.pid 2>/dev/null; }
wat_pid()  { [ -f watcher.lock ] && cat watcher.lock 2>/dev/null; }

alive()    { p="$1"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

case "${1:-help}" in
  start)
    N="${2:-15}"
    if sp="$(sup_pid)" && alive "$sp"; then
      echo "already running (supervisor pid $sp)"; exit 0
    fi
    rm -f PAUSE
    echo "$N" > catchup.txt
    setsid --fork bash "$0" _supervisor_boot >/dev/null 2>&1
    sleep 2
    echo "started (supervisor pid $(sup_pid 2>/dev/null || echo '?')) catchup=${N}m"
    ;;
  _supervisor_boot)
    exec bash supervisor.sh
    ;;
  pause)
    touch PAUSE
    echo "PAUSE set — watcher exits within ~10 s; session now free"
    ;;
  resume)
    N="${2:-5}"
    rm -f PAUSE
    echo "$N" > catchup.txt
    echo "resumed (catchup ${N} min) — watcher returns within ~5 s"
    ;;
  stop)
    rm -f PAUSE
    sp="$(sup_pid)"; wp="$(wat_pid)"
    [ -n "$sp" ] && kill "$sp" 2>/dev/null && echo "supervisor $sp killed"
    [ -n "$wp" ] && kill "$wp" 2>/dev/null && echo "watcher $wp killed"
    rm -f supervisor.pid watcher.lock
    sleep 1
    # kill ONLY the main watcher — never per-account instances (v7)
    for p in $(pgrep -f "watcher\.py" 2>/dev/null); do
      if tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null \
          | grep -qx "W_INSTANCE_DIR=.*"; then
        continue
      fi
      kill "$p" 2>/dev/null
    done
    echo "stopped"
    ;;
  status)
    sp="$(sup_pid)"; wp="$(wat_pid)"
    echo "supervisor: $(alive "$sp" && echo "RUNNING pid $sp" || echo down)"
    echo "watcher:   $(alive "$wp" && echo "RUNNING pid $wp" || echo down)"
    echo "pause:     $([ -f PAUSE ] && echo YES || echo no)"
    [ -f state.json ] && cat state.json
    ;;
  expiry)
    "$PY" - <<'EOF'
import json, time
try:
    s = json.load(open("state.json"))
    left = s["window_end"] - time.time()
    if left <= 0:
        print("EXPIRED")
    else:
        print(f"{left/86400:.2f} days left "
              f"({int(left//3600)}h {int(left%3600//60)}m)")
except Exception as e:
    print("no state yet:", e)
EOF
    ;;
  log)
    tail -n "${2:-30}" wlog.jsonl 2>/dev/null || echo "no log yet"
    ;;
  *)
    sed -n '2,12p' "$0"
    ;;
esac
