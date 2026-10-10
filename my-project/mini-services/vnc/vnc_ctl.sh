#!/usr/bin/env bash
# vnc_ctl.sh — control the noVNC desktop service (:6080 web + :5900 vnc)
#   start | stop | restart | status
set -u
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")"
VNC_DIR="$(pwd)"
WEBSOCKIFY=/home/z/.venv/bin/websockify

sup_pid() { [ -f supervisor.pid ] && cat supervisor.pid 2>/dev/null; }
alive()   { p="$1"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

kill_desktop() {
  # the whole desktop tree shares one process group (setsid on run-session.sh)
  local pid pgid
  pid="$(pgrep -x x11vnc | head -1 || true)"
  if [ -n "$pid" ]; then
    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [ -n "$pgid" ] && kill -TERM -- "-$pgid" 2>/dev/null
  fi
  sleep 1
  # belt & braces: exact-name sweep for any orphaned desktop component
  for p in x11vnc Xvfb xfce4-session xfwm4 xfdesktop xfce4-panel \
           xfconfd xfsettingsd tumblerd xfce4-notifyd dbus-run-session; do
    pkill -x "$p" 2>/dev/null
  done
  # session dbus-daemons spawned by our tree (host has none of its own;
  # identify ours via DISPLAY=:99 in their environment)
  for pid in $(pgrep -x dbus-daemon 2>/dev/null); do
    if tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -q '^DISPLAY=:99$'; then
      kill "$pid" 2>/dev/null
    fi
  done
}

kill_web() {
  pkill -f "websockify.*6080" 2>/dev/null
}

case "${1:-help}" in
  start)
    if p="$(sup_pid)" && alive "$p"; then
      echo "already running (supervisor pid $p)"
      exit 0
    fi
    rm -f supervisor.pid
    # clean slate: any stale desktop tree or old websockify from before
    kill_web; kill_desktop
    setsid --fork bash supervisor.sh >/dev/null 2>&1 </dev/null
    sleep 6
    echo "started (supervisor pid $(sup_pid 2>/dev/null || echo '?'))"
    "$SELF" status
    ;;
  stop)
    p="$(sup_pid)"
    [ -n "$p" ] && kill "$p" 2>/dev/null && echo "supervisor $p killed"
    rm -f supervisor.pid
    kill_web;  echo "websockify stopped"
    kill_desktop; echo "desktop session stopped"
    echo "stopped"
    ;;
  restart)
    "$SELF" stop; sleep 2; "$SELF" start
    ;;
  status)
    p="$(sup_pid)"
    if [ -n "$p" ] && alive "$p"; then echo "supervisor: $p (alive)"; else echo "supervisor: not running"; fi
    if ss -tln 2>/dev/null | grep -q '127.0.0.1:6080'; then echo "web  :6080 — listening"; else echo "web  :6080 — down"; fi
    if ss -tln 2>/dev/null | grep -q '127.0.0.1:5900'; then echo "vnc  :5900 — listening"; else echo "vnc  :5900 — down"; fi
    if pgrep -x x11vnc >/dev/null 2>&1; then echo "desktop — up ($(pgrep -x x11vnc | head -1))"; else echo "desktop — down"; fi
    ;;
  *)
    echo "usage: $0 start|stop|restart|status"
    ;;
esac
