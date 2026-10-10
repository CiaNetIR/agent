#!/usr/bin/env bash
# instances_ctl.sh — manage per-account watcher instances (panel «اکانت‌ها»).
# Each account added in the panel gets its own isolated dir:
#   /home/z/tg-tools/instances/<account-id>/
#     env            TELEGRAM_SESSION_STRING (0600)
#     config.json    persona/footer/thinking/blacklist/instructions…
#     state.json / wlog.jsonl / watcher.lock / supervisor.pid / catchup.txt
# Usage: instances_ctl.sh <account-id> start|stop|restart|status|log [N]
set -u
ID="${1:?account id required}"
CMD="${2:-status}"
WATCHER_HOME="/home/z/tg-tools/watcher"
INST="/home/z/tg-tools/instances/$ID"

sup_pid() { [ -f "$INST/supervisor.pid" ] && cat "$INST/supervisor.pid" 2>/dev/null; }
wat_pid() { [ -f "$INST/watcher.lock" ] && cat "$INST/watcher.lock" 2>/dev/null; }
alive()   { p="$1"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

case "$CMD" in
  start)
    [ -d "$INST" ] || { echo "no such instance: $ID"; exit 1; }
    [ -f "$INST/env" ] || { echo "instance env missing (no session)"; exit 1; }
    if sp="$(sup_pid)" && alive "$sp"; then
      echo "already running (supervisor pid $sp)"; exit 0
    fi
    rm -f "$INST/PAUSE" "$INST/supervisor.pid" "$INST/watcher.lock"
    echo 10 > "$INST/catchup.txt"
    ( cd "$WATCHER_HOME" && W_INSTANCE_DIR="$INST" \
        setsid --fork bash supervisor.sh >/dev/null 2>&1 )
    sleep 2
    echo "started (supervisor pid $(sup_pid 2>/dev/null || echo '?'))"
    ;;
  stop)
    sp="$(sup_pid)"; wp="$(wat_pid)"
    [ -n "$sp" ] && kill "$sp" 2>/dev/null && echo "supervisor $sp killed"
    [ -n "$wp" ] && kill "$wp" 2>/dev/null && echo "watcher $wp killed"
    rm -f "$INST/supervisor.pid" "$INST/watcher.lock"
    sleep 1
    # kill ONLY this instance's watcher process — never the main watcher
    for p in $(pgrep -f "watcher\.py" 2>/dev/null); do
      if tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null \
          | grep -qx "W_INSTANCE_DIR=$INST"; then
        kill "$p" 2>/dev/null
      fi
    done
    echo "stopped"
    ;;
  restart)
    "$0" "$ID" stop; sleep 1; "$0" "$ID" start
    ;;
  status)
    sp="$(sup_pid)"; wp="$(wat_pid)"
    echo "supervisor: $(alive "$sp" && echo "RUNNING pid $sp" || echo down)"
    echo "watcher:   $(alive "$wp" && echo "RUNNING pid $wp" || echo down)"
    echo "pause:     $([ -f "$INST/PAUSE" ] && echo YES || echo no)"
    [ -f "$INST/state.json" ] && cat "$INST/state.json"
    ;;
  log)
    tail -n "${3:-20}" "$INST/wlog.jsonl" 2>/dev/null || echo "no log yet"
    ;;
  *)
    sed -n '2,9p' "$0"
    ;;
esac
