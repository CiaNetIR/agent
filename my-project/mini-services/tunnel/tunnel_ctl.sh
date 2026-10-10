#!/usr/bin/env bash
# tunnel_ctl.sh — control the cloudflared tunnel connector (mini-services/tunnel)
#   start | stop | restart | status
# NOTE: the stop/pkill patterns ("tunnel[-]run[.]sh", "bin/cloudflared",
# "provision-watcher[.]sh") are bracket-escaped so they can never match the
# Telegram watcher or any other service — only this tunnel stack.
set -u
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")"
TOKEN_FILE="/home/z/my-project/.secrets/cloudflare/tunnel-token.txt"

sup_pid() { [ -f supervisor.pid ] && cat supervisor.pid 2>/dev/null; }
alive()   { p="$1"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

case "${1:-help}" in
  start)
    if [ ! -s "$TOKEN_FILE" ]; then
      echo "no tunnel token yet — nothing to start (provision-watcher will provision when the API token appears)"
      exit 0
    fi
    if p="$(sup_pid)" && alive "$p"; then
      echo "already running (supervisor pid $p)"
      exit 0
    fi
    rm -f supervisor.pid
    setsid --fork bash /home/z/my-project/mini-services/tunnel/supervisor.sh >/dev/null 2>&1 </dev/null
    sleep 2
    echo "started (supervisor pid $(sup_pid 2>/dev/null || echo '?'))"
    ;;
  stop)
    p="$(sup_pid)"
    if [ -n "$p" ]; then kill "$p" 2>/dev/null && echo "supervisor $p killed"; fi
    pkill -f "tunnel[-]run[.]sh" 2>/dev/null && echo "tunnel-run killed"
    pkill -f "bin/cloudflared" 2>/dev/null && echo "cloudflared killed"
    rm -f supervisor.pid
    echo "stopped"
    ;;
  restart)
    "$SELF" stop; sleep 1; "$SELF" start
    ;;
  status)
    p="$(sup_pid)"
    echo "supervisor: $(alive "$p" && echo "RUNNING pid $p" || echo down)"
    if pgrep -f "bin/cloudflared" >/dev/null; then
      echo "connector: RUNNING pid $(pgrep -f 'bin/cloudflared' | head -1)"
    else
      echo "connector: down"
    fi
    if pgrep -f "provision-watcher[.]sh" >/dev/null; then
      echo "provision-watcher: RUNNING pid $(pgrep -f 'provision-watcher[.]sh' | head -1)"
    else
      echo "provision-watcher: down"
    fi
    if [ -s "$TOKEN_FILE" ]; then echo "token: present"; else echo "token: absent (not provisioned yet)"; fi
    echo "--- last service.log lines ---"
    tail -n 10 service.log 2>/dev/null || echo "(no service.log yet)"
    ;;
  *)
    sed -n '2,4p' "$0"
    ;;
esac
