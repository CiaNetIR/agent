#!/usr/bin/env bash
# panel-supervisor.sh — پنل مدیریت (:3000) را همیشه بالا نگه می‌دارد.
#
# چرا این فایل وجود دارد؟  ۱۴ مهر ۱۴۰۴ (2026-10-08) کرنل به‌خاطر کمبود رم
# پروسهٔ next-server را OOM-kill کرد و پنل تا مدتی‌ها پایین ماند. این
# نگهدارندهٔ کم‌مصرف (~۲MB) هر ۳۰ ثانیه سلامت پورت ۳۰۰۰ را چک می‌کند و:
#   ۱) اتصال قطع (process مرده) → ۲ چک پیاپی → ری‌استارت تمیز (~۶۰-۹۰s).
#   ۲) کندی/تایم‌اوت (پروسه زنده ولی مشغول — مثلاً زیر فشار بکاپ ساعتی)
#      → تحمل تا ۲ دقیقه (وقتی بکاپ در جریانه تا ۱۰ دقیقه) → ری‌استارت
#      فقط اگر واقعاً هنگ کرده باشه. این یعنی: صفر ری‌استارت بی‌خود.
#   ۳) اگر مصرف رم next-server از سقف عبور کند (پیش‌گیری از OOM) →
#      ری‌استارت نرم و کنترل‌شده.
#
# الگوی راه‌اندازی: watcher-proven —  setsid --fork  (توسط panel_ctl.sh)
set -u
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SELF_DIR/.." && pwd)"
cd "$ROOT"

PID_FILE="$SELF_DIR/panel-supervisor.pid"
LOG="$SELF_DIR/panel-supervisor.log"
URL='http://127.0.0.1:3000/'

# سقف رم next-server بر حسب KB (پیش‌فرض ~1.95GB؛ قابل‌تغییر با فایل فلگ)
RSS_LIMIT_KB=2000000
[ -f "$SELF_DIR/panel-ram-limit-kb" ] && RSS_LIMIT_KB="$(tr -d '[:space:]' < "$SELF_DIR/panel-ram-limit-kb")"

# تعداد چرخه‌های «کندی» پیاپی قبل از ری‌استارت پنلِ زنده-ولی-بی‌جواب
# (پیش‌فرض ۴ = ~۲ دقیقه). کامپایل سردِ Turbopack روی این سرور ۲vCPU ممکنه
# ۳-۶ دقیقه طول بکشه؛ با فایل فلگ panel-slow-limit قابل‌افزایشه.
SLOW_LIMIT=4
[ -f "$SELF_DIR/panel-slow-limit" ] && SLOW_LIMIT="$(tr -d '[:space:]' < "$SELF_DIR/panel-slow-limit")"

say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

# لاگ را کوچک نگه دار
[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 131072 ] && : > "$LOG"

echo $$ > "$PID_FILE"
say "supervisor up (pid $$) — rss-limit=${RSS_LIMIT_KB}KB slow-limit=${SLOW_LIMIT} interval=30s probe=ok/slow/down"

panel_rss_kb() {  # RSS بزرگ‌ترین next-server بر حسب KB (یا 0)
  ps -eo rss,args 2>/dev/null | awk '$2 ~ /next-server/ {if ($1 > m) m = $1} END {print m + 0}'
}

# سلامت را با تفکیک سه حالت می‌سنجم:
#   ok   → HTTP 200 در مهلت 15s
#   slow → تایم‌اوت (پروسه زنده ولی مشغول/کم‌آورده؛ زیر فشار بکاپ طبیعیه)
#   down → اتصال رد/قطع یا کد غیر 200 (پروسه مرده یا خراب)
probe() {
  local code rc
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$URL" 2>/dev/null)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    if [ "$code" = "200" ]; then echo ok; else echo down; fi
  elif [ "$rc" -eq 28 ]; then
    echo slow
  else
    echo down
  fi
}

backup_running() { pgrep -f 'run-backup' >/dev/null 2>&1; }

kill_panel() {
  pkill -f 'next dev' 2>/dev/null
  pkill -f 'next-server' 2>/dev/null
  sleep 2
  pkill -9 -f 'next-server' 2>/dev/null
}

start_panel() {
  setsid nohup bun run dev >/dev/null 2>&1 < /dev/null &
  say "started: bun run dev (bg pid $!)"
}

recycle() {
  kill_panel
  start_panel
  sleep 90   # فرصت بوت؛ در این پنجره چک نکن
}

hard=0   # اتصال قطع پیاپی (پروسه مرده)
slow=0   # تایم‌اوت پیاپی (پروسه زنده ولی بی‌جواب)
while true; do
  case "$(probe)" in
    ok)
      if [ "$hard" -ne 0 ] || [ "$slow" -ne 0 ]; then
        say "recovered: health-check ok again"
      fi
      hard=0; slow=0
      rss="$(panel_rss_kb)"
      if [ "$rss" -gt "$RSS_LIMIT_KB" ]; then
        say "RAM guard: next-server rss=${rss}KB > ${RSS_LIMIT_KB}KB → soft recycle"
        recycle
      fi
      ;;
    slow)
      slow=$((slow + 1)); hard=0
      if backup_running; then
        # فشار بکاپ ساعتی موقتیه — تا ۱۰ دقیقه تحمل کن، ری‌استارت نکن
        if [ "$slow" -eq 1 ] || [ $((slow % 4)) -eq 0 ]; then
          say "slow under backup load (timeout #$slow) — tolerated"
        fi
        if [ "$slow" -ge 20 ]; then
          say "unresponsive >10min even after backup → clean restart"
          recycle; hard=0; slow=0
        fi
      else
        say "health-check timeout #$slow (process alive, not answering)"
        if [ "$slow" -ge "$SLOW_LIMIT" ]; then
          say "panel hung ~$((SLOW_LIMIT / 2))min → clean restart"
          recycle; hard=0; slow=0
        fi
      fi
      ;;
    down)
      hard=$((hard + 1)); slow=0
      say "health-check fail #$hard (refused/broken)"
      if [ "$hard" -ge 2 ]; then
        say "panel down → clean restart"
        recycle; hard=0; slow=0
      fi
      ;;
  esac
  sleep 30
done
