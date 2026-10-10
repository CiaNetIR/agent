#!/usr/bin/env bash
# sshd_ctl.sh — start/stop/status for the userspace sshd service
set -u
cd "$(dirname "$0")"

is_running() { pgrep -f 'opt/openssh/usr/sbin/sshd' >/dev/null 2>&1; }

case "${1:-status}" in
  start)
    if is_running; then echo "sshd already running"; exit 0; fi
    : > service.log
    setsid --fork bash supervisor.sh >> supervisor-boot.log 2>&1
    sleep 1
    is_running && echo "sshd started" || { echo "FAILED to start — see service.log"; exit 1; }
    ;;
  stop)
    [ -f supervisor.pid ] && kill "$(cat supervisor.pid)" 2>/dev/null
    pkill -f 'opt/openssh/usr/sbin/sshd' 2>/dev/null
    echo "sshd stopped"
    ;;
  restart)
    "$0" stop; sleep 1; "$0" start
    ;;
  status)
    if is_running; then
      echo "sshd RUNNING (pid $(pgrep -f 'opt/openssh/usr/sbin/sshd' | head -1))"
    else
      echo "sshd STOPPED"
    fi
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status}" >&2; exit 1 ;;
esac
