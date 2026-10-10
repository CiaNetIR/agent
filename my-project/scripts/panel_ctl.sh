#!/usr/bin/env bash
# panel_ctl.sh — کنترل پنل مدیریت (:3000) و نگهدارندهٔ آن
#   start | stop | restart | status | log [N] | ram-limit [KB]
set -u
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/.."

sup_pid() { [ -f scripts/panel-supervisor.pid ] && cat scripts/panel-supervisor.pid 2>/dev/null; }
alive()   { p="$1"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

case "${1:-help}" in
  start)
    if p="$(sup_pid)" && alive "$p"; then
      echo "supervisor از قبل فعال است (pid $p)"
      exit 0
    fi
    rm -f scripts/panel-supervisor.pid
    setsid --fork bash scripts/panel-supervisor.sh >/dev/null 2>&1 </dev/null
    sleep 2
    # اگر پنل خودش بالا نبود، نگهدارنده در چرخهٔ بعدی (≤۶۰s) بالا می‌آوردش
    echo "supervisor راه افتاد (pid $(sup_pid 2>/dev/null || echo '?')) — پنل تا ~۹۰ ثانیه دیگر تضمیناً بالاست"
    ;;
  stop)
    p="$(sup_pid)"
    if [ -n "$p" ]; then kill "$p" 2>/dev/null && echo "supervisor $p متوقف شد"; fi
    pkill -f 'next dev' 2>/dev/null
    pkill -f 'next-server' 2>/dev/null
    rm -f scripts/panel-supervisor.pid
    echo "پنل و نگهدارنده متوقف شدند"
    ;;
  restart)
    "$SELF" stop; sleep 1
    setsid nohup bun run dev >/dev/null 2>&1 < /dev/null &
    "$SELF" start
    ;;
  status)
    p="$(sup_pid)"
    if alive "$p"; then echo "supervisor : فعال (pid $p)"; else echo "supervisor : خاموش"; fi
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 6 http://127.0.0.1:3000/ 2>/dev/null || echo 000)"
    echo "پنل :3000  → HTTP $code $([ "$code" = 200 ] && echo '✓')"
    rss="$(ps -eo rss,args 2>/dev/null | awk '$2 ~ /next-server/ {if ($1 > m) m = $1} END {printf "%.0f", m/1024}')"
    [ -n "$rss" ] && [ "$rss" != "0" ] && echo "next-server RAM : ${rss} MB"
    echo "آخرین رویدادها:"; tail -n 5 scripts/panel-supervisor.log 2>/dev/null || echo "  (بدون لاگ)"
    ;;
  log)
    tail -n "${2:-40}" scripts/panel-supervisor.log 2>/dev/null || echo "(بدون لاگ)"
    ;;
  ram-limit)
    if [ -n "${2:-}" ]; then
      echo "$2" > scripts/panel-ram-limit-kb
      echo "سقف رم next-server ← $2 KB (از چرخهٔ بعدی اعمال می‌شود)"
    else
      [ -f scripts/panel-ram-limit-kb ] && cat scripts/panel-ram-limit-kb || echo "2000000 (پیش‌فرض)"
    fi
    ;;
  *)
    echo "استفاده: $0 {start|stop|restart|status|log [N]|ram-limit [KB]}"
    ;;
esac
