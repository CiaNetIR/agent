#!/usr/bin/env bash
# supervisor.sh — watchdog for the noVNC desktop service.
# Keeps both halves alive:
#   1. websockify  :6080 (web UI → ws bridge, 127.0.0.1 only)
#   2. the isolated Alpine desktop tree (:5900 via x11vnc)
set -u
cd "$(dirname "$0")"
VNC_DIR="$(pwd)"
WEBSOCKIFY=/home/z/.venv/bin/websockify
echo $$ > supervisor.pid

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >> service.log; }

log "supervisor up (pid $$)"
while true; do
  # --- websockify half ---
  if ! ss -tln 2>/dev/null | grep -q '127.0.0.1:6080'; then
    log "websockify not listening — starting"
    setsid nohup "$WEBSOCKIFY" --web "$VNC_DIR/web" 127.0.0.1:6080 localhost:5900 >> service.log 2>&1 &
  fi

  # --- desktop half ---
  if ! pgrep -x x11vnc >/dev/null 2>&1; then
    # make sure no half-dead tree blocks the display, then boot fresh
    for p in Xvfb xfce4-session xfwm4 xfdesktop xfce4-panel dbus-run-session; do
      pkill -x "$p" 2>/dev/null
    done
    sleep 1
    log "desktop down — starting session"
    setsid nohup "$VNC_DIR/run-session.sh" >> service.log 2>&1 &
  fi

  sleep 10
done
