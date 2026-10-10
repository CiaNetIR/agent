#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  کیت اضطراری API — CiaNet / دستیار Z          (نسخهٔ ۱ — ۲۰۲۶/۱۰/۰۸)
# ══════════════════════════════════════════════════════════════════════
#  ⚠️ هیچ secret داخل این فایل نیست — در لحظهٔ اجرا از /etc/.z-ai-config
#     خوانده می‌شود. این فایل در بکاپ ساعتی + گیت + زیپ روزانه هست.
#
#  اجرا (از ترمینال پنل یا SSH):
#     bash /home/z/my-project/scripts/emergency-api.sh card        ← کارت راهنما
#     bash /home/z/my-project/scripts/emergency-api.sh status      ← سلامت همه‌چیز
#     bash /home/z/my-project/scripts/emergency-api.sh chat "سلام"
#     bash /home/z/my-project/scripts/emergency-api.sh image "گربه فضانورد" out.jpg
#     bash /home/z/my-project/scripts/emergency-api.sh video "اژدها روی ابرها" 5 speed out.mp4
#     bash /home/z/my-project/scripts/emergency-api.sh paths       ← مسیر فایل‌های حیاتی
#
#  مدت ویدیو فقط ۵ یا ۱۰ ثانیه است (محدودیت API) — ویدیوی طولانی‌تر را
#  موتور چندکلیپی خود پنل می‌سازد (دستور «ویدیو:» در چت پنل).
# ══════════════════════════════════════════════════════════════════════
set -u

CFG="/etc/.z-ai-config"
COOLDOWN="/home/z/agent-files/llm-cooldown.json"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { red "✗ $*" >&2; exit 1; }

[ -r "$CFG" ] || die "فایل کانفیگ $CFG خوانا نیست — بدون آن دسترسی به API ممکن نیست"
command -v jq    >/dev/null || die "jq نصب نیست"
command -v curl  >/dev/null || die "curl نصب نیست"

# ── خواندن کانفیگ (هرگز چاپ نشود) ─────────────────────────────────────
BASE=$(jq -r '.baseUrl // empty' "$CFG")
KEY=$(jq -r '.apiKey  // empty' "$CFG")
TOKEN=$(jq -r '.token   // empty' "$CFG")
CHATID=$(jq -r '.chatId  // empty' "$CFG")
USERID=$(jq -r '.userId  // empty' "$CFG")
[ -n "$BASE" ] && [ -n "$KEY" ] || die "کانفیگ ناقص است (baseUrl/apiKey)"

# هدرها دقیقاً مثل SDK — به‌صورت آرایه (هرگز چاپ/word-split نشود)
declare -a HDRS=(-H "Content-Type: application/json" -H "Authorization: Bearer $KEY" -H "X-Z-AI-From: Z")
[ -n "$CHATID" ] && HDRS+=(-H "X-Chat-Id: $CHATID")
[ -n "$USERID" ] && HDRS+=(-H "X-User-Id: $USERID")
[ -n "$TOKEN" ] && HDRS+=(-H "X-Token: $TOKEN")

cooldown_check() {
  [ -f "$COOLDOWN" ] || return 0
  local until_ms now_ms
  until_ms=$(jq -r '.until // 0 | floor' "$COOLDOWN" 2>/dev/null) || return 0
  case "$until_ms" in ''|*[!0-9]*) return 0;; esac
  now_ms=$(date +%s%3N)
  if [ "${until_ms:-0}" -gt "$now_ms" ]; then
    local left=$(( (until_ms - now_ms) / 1000 ))
    ylw "⏳ توجه: سیستم عمداً تا $left ثانیهٔ دیگر صبر می‌کند (قفل نرخ ۴۲۹ provider — مدارشکن مشترک)."
    ylw "   درخواست دستی الان احتمالاً هم 429 می‌خورد؛ مگر اینکه مطمئنی قفل باز شده."
  fi
}

# ── status ────────────────────────────────────────────────────────────
cmd_status() {
  echo "═══ وضعیت سیستم CiaNet — $(date '+%Y-%m-%d %H:%M:%S') ═══"
  echo
  echo "── سرویس‌های داخلی ──"
  for s in "پنل:3000:/" "ایجنت:3004:/healthz" "بکاپ:3010:/healthz" "ترمینال:3001:/"; do
    local name rest port path_ code
    name=${s%%:*}; rest=${s#*:}; port=${rest%%:*}; path_=${rest#*:}
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 6 "http://127.0.0.1:$port$path_" 2>/dev/null)
    if [ "$code" = "200" ]; then grn "  ✓ $name (:$port) — $code"
    elif [ "$name" = "ترمینال" ] && [ "$code" = "400" ]; then grn "  ✓ $name (:$port) — $code (websocket-only، سالم)"
    else red "  ✗ $name (:$port) — $code"; fi
  done
  if pgrep -f "watcher.py" >/dev/null; then grn "  ✓ واتچر تلگرام — RUNNING (pid $(pgrep -f watcher.py | head -1))"
  else red "  ✗ واتچر تلگرام — خاموش!  →  bash /home/z/tg-tools/watcher_ctl.sh start 40"; fi
  echo
  echo "── فایل‌های حیاتی ──"
  [ -r "$CFG" ] && grn "  ✓ کانفیگ API: $CFG" || red "  ✗ کانفیگ API نیست!"
  for f in /home/z/my-project/.secrets/panel.env /home/z/my-project/.secrets/tg.env /home/z/.github-token; do
    [ -s "$f" ] && grn "  ✓ $f" || red "  ✗ $f خالی/گم شده!"
  done
  echo
  echo "── API هوش مصنوعی (provider) ──"
  cooldown_check
  local t0 t1 probe
  t0=$(date +%s%3N)
  probe=$(curl -s -m 45 -w '\n%{http_code}' -X POST "$BASE/chat/completions" \
    "${HDRS[@]}" \
    -d '{"messages":[{"role":"user","content":"فقط بنویس: ok"}],"thinking":{"type":"disabled"}}' 2>/dev/null)
  t1=$(date +%s%3N)
  local code body
  body=$(printf '%s' "$probe" | sed '$d'); code=$(printf '%s' "$probe" | tail -1)
  if [ "$code" = "200" ]; then
    local ans; ans=$(printf '%s' "$body" | jq -r '.choices[0].message.content // "?"' 2>/dev/null | head -c 60)
    grn "  ✓ چت — $code در $((t1-t0))ms → «$ans»"
  else
    red "  ✗ چت — HTTP $code: $(printf '%s' "$body" | head -c 180)"
    case "$code" in
      429) ylw "    → محدودیت نرخ: صبر کن (سیستم خودش backoff پلکانی دارد) و چند دقیقه بعد status بگیر";;
      401|403) ylw "    → اعتبارنامه رد شد: فایل $CFG را با نسخهٔ پشتیبان .secrets/z-ai-config.json مقایسه کن";;
    esac
  fi
  echo
  echo "── منابع ──"
  free -m | awk 'NR==2{printf "  رم: %sMB آزاد از %sMB\n",$7,$2}'
  df -h /home | awk 'NR==2{printf "  دیسک /home: %s آزاد از %s (%s استفاده)\n",$4,$2,$5}'
}

# ── chat ──────────────────────────────────────────────────────────────
cmd_chat() {
  local msg="${1:-}"; [ -n "$msg" ] || die "متن پیام را بده:  emergency-api.sh chat \"سلام\""
  cooldown_check
  local body code
  body=$(jq -n --arg m "$msg" '{messages:[{role:"user",content:$m}],thinking:{type:"disabled"}}')
  local t0=$SECONDS resp
  resp=$(curl -s -m 120 -w '\n%{http_code}' -X POST "$BASE/chat/completions" "${HDRS[@]}" -d "$body")
  code=$(printf '%s' "$resp" | tail -1)
  if [ "$code" != "200" ]; then die "HTTP $code: $(printf '%s' "$resp" | sed '$d' | head -c 250)"; fi
  printf '%s' "$resp" | sed '$d' | jq -r '.choices[0].message.content // "پاسخ خالی بود"'
}

# ── image ─────────────────────────────────────────────────────────────
cmd_image() {
  local prompt="${1:-}" out="${2:-emergency-img-$(date +%H%M%S).jpg}" size="${3:-1024x1024}"
  [ -n "$prompt" ] || die "پرامپت بده:  emergency-api.sh image \"گربه فضانورد\" out.jpg [1024x1024]"
  cooldown_check
  local body
  body=$(jq -n --arg p "$prompt" --arg s "$size" '{prompt:$p,size:$s}')
  ylw "⏳ در حال ساخت تصویر… (۲۰-۹۰ ثانیه)"
  local resp code payload
  resp=$(curl -s -m 300 -w '\n%{http_code}' -X POST "$BASE/images/generations" "${HDRS[@]}" -d "$body")
  code=$(printf '%s' "$resp" | tail -1)
  payload=$(printf '%s' "$resp" | sed '$d')
  # فیلتر 1301 سمت provider گاهی بی‌دلیل پرنده می‌زند — یک ریتری صادقانه (مثل خود ایجنت)
  if [ "$code" = "400" ] && printf '%s' "$payload" | grep -q '1301'; then
    ylw "  (فیلتر لحظه‌ای provider — یک تلاش دیگر…)"
    sleep 4
    resp=$(curl -s -m 300 -w '\n%{http_code}' -X POST "$BASE/images/generations" "${HDRS[@]}" -d "$body")
    code=$(printf '%s' "$resp" | tail -1)
    payload=$(printf '%s' "$resp" | sed '$d')
  fi
  [ "$code" = "200" ] || die "HTTP $code: $(printf '%s' "$payload" | head -c 300)"
  # دو حالت: url مستقیم یا base64
  local url b64
  url=$(printf '%s' "$payload" | jq -r '.data[0].url // empty')
  b64=$(printf '%s' "$payload" | jq -r '.data[0].base64 // .data[0].b64_json // empty')
  if [ -n "$url" ]; then
    curl -s -m 120 -o "$out" "$url" || die "دانلود تصویر ناموفق"
  elif [ -n "$b64" ] && [ "$b64" != "null" ]; then
    printf '%s' "$b64" | base64 -d > "$out"
  else
    die "پاسخ نه url داشت نه base64: $(printf '%s' "$payload" | head -c 200)"
  fi
  # پسوند درست از بایت‌های جادویی
  local magic; magic=$(head -c 2 "$out" | od -An -tx1 | tr -d ' \n')
  case "$magic" in
    ffd8) [ "${out##*.}" = "jpg" ] || out="$out.jpg" ;;
    8950) [ "${out##*.}" = "png" ] || out="$out.png" ;;
  esac
  [ -s "$out" ] || die "فایل خالی ساخته شد"
  grn "✅ تصویر ساخته شد: $out ($(du -h "$out" | cut -f1 | tr -d ' '))"
}

# ── video ─────────────────────────────────────────────────────────────
cmd_video() {
  local prompt="${1:-}" dur="${2:-5}" quality="${3:-speed}" out="${4:-emergency-vid-$(date +%H%M%S).mp4}"
  [ -n "$prompt" ] || die 'پرامپت بده:  emergency-api.sh video "اژدها روی ابرها" 5 speed out.mp4'
  [ "$dur" = "5" ] || [ "$dur" = "10" ] || die "مدت فقط ۵ یا ۱۰ ثانیه (محدودیت API — طولانی‌تر: چت پنل با دستور «ویدیو:»)"
  [ "$quality" = "speed" ] || [ "$quality" = "quality" ] || die "کیفیت فقط speed یا quality"
  cooldown_check
  local body task
  body=$(jq -n --arg p "$prompt" --arg q "$quality" --argjson d "$dur" \
    '{prompt:$p,quality:$q,with_audio:false,size:"1920x1080",fps:30,duration:$d}')
  ylw "⏳ ثبت تسک ویدیو…"
  local resp
  resp=$(curl -s -m 300 -w '\n%{http_code}' -X POST "$BASE/video/generation" "${HDRS[@]}" -d "$body")
  local code; code=$(printf '%s' "$resp" | tail -1)
  [ "$code" = "200" ] || die "HTTP $code: $(printf '%s' "$resp" | sed '$d' | head -c 300)"
  task=$(printf '%s' "$resp" | sed '$d' | jq -r '.id // empty')
  [ -n "$task" ] || die "پاسخ تسک نداشت: $(printf '%s' "$resp" | sed '$d' | head -c 200)"
  ylw "  شناسهٔ تسک: $task — در حال پرس‌وجو (هر ۸ ثانیه، حداکثر ۱۰ دقیقه)…"
  local i st vurl
  for i in $(seq 1 75); do
    sleep 8
    resp=$(curl -s -m 60 -w '\n%{http_code}' -G "$BASE/async-result" "${HDRS[@]}" --data-urlencode "id=$task")
    code=$(printf '%s' "$resp" | tail -1)
    if [ "$code" != "200" ]; then ylw "  (poll خطای $code — ادامه…)"; continue; fi
    st=$(printf '%s' "$resp" | sed '$d' | jq -r '.task_status // empty')
    if [ "$st" = "SUCCESS" ]; then
      vurl=$(printf '%s' "$resp" | sed '$d' | jq -r '.video_result[0].url // .video_url // .url // empty')
      [ -n "$vurl" ] || die "تسک SUCCESS بود ولی url نداشت: $(printf '%s' "$resp" | sed '$d' | head -c 250)"
      curl -s -m 300 -o "$out" "$vurl" || die "دانلود ویدیو ناموفق"
      [ -s "$out" ] || die "فایل ویدیو خالی است"
      grn "✅ ویدیو ساخته شد: $out ($(du -h "$out" | cut -f1 | tr -d ' '))"
      ffprobe -v error -show_entries format=duration -of csv=p=0 "$out" 2>/dev/null | awk '{printf "   مدت: %.1f ثانیه\n",$1}'
      return 0
    fi
    if [ "$st" = "FAIL" ]; then die "تسک ویدیو FAIL شد: $(printf '%s' "$resp" | sed '$d' | head -c 250)"; fi
    [ $((i % 4)) -eq 0 ] && ylw "  … همچنان PROCESSING ($((i*8))s)"
  done
  die "مهلت ۱۰ دقیقه‌ای تمام شد — تسک $task ممکن است بعداً آماده شود؛ بعداً دوباره امتحان کن"
}

# ── paths ─────────────────────────────────────────────────────────────
cmd_paths() {
  cat <<'EOS'
── مسیر فایل‌های حیاتی (برای نجات‌دادن در بحران) ──
  /etc/.z-ai-config                          ← اعتبارنامهٔ API هوش مصنوعی (همین یک فایل = کل دسترسی AI)
  /home/z/my-project/.secrets/               ← رمز پنل، توکن تلگرام، کانفیگ واتچر
  /home/z/my-project/.secrets/z-ai-config.json ← نسخهٔ پشتیبان خودکار همان فایل بالا (از این تاریخ در بکاپ)
  /home/z/.github-token                      ← توکن گیت (پشتیبان‌گیری)
  /home/z/my-project/db/custom.db            ← دیتابیس کامل (پیام‌ها، ویدیوها، تنظیمات، فاکتورها)
  /home/z/agent-files/llm-cooldown.json      ← وضعیت قفل نرخ ۴۲۹ (مشترک بین همهٔ سرویس‌ها)
  /home/z/recovery/                          ← زیپ‌های نقطه‌ای روزانه (۳۰ نسخهٔ آخر) — ضد حذف
  /home/z/agent-repo/                        ← میرور گیت (تاریخ کامل روی github.com/CiaNetIR/agent)

── برای دیدن/کپی‌کردن اعتبارنامهٔ AI با چشم خودت (روی سرور خودت) ──
  sudo cat /etc/.z-ai-config
EOS
}

# ── card ──────────────────────────────────────────────────────────────
cmd_card() {
  cat <<'EOS'
╔══════════════════════════════════════════════════════════════════╗
║          🚨 کارت اضطراری API — CiaNet / دستیار Z                   ║
╚══════════════════════════════════════════════════════════════════╝
 ▸ provider هوش مصنوعی (این سرورها سالم‌اند و همهٔ چت/تصویر/ویدیو از همین‌جا می‌آید):
    POST  https://internal-api.z.ai/v1/chat/completions      ← چت
    POST  https://internal-api.z.ai/v1/images/generations    ← تصویر
    POST  https://internal-api.z.ai/v1/video/generation      ← ویدیو (۵/۱۰ ثانیه)
    GET   https://internal-api.z.ai/v1/async-result?id=…     ← نتیجهٔ ویدیو
    POST  https://internal-api.z.ai/v1/audio/tts             ← گفتار
    POST  https://internal-api.z.ai/v1/audio/asr             ← تشخیص گفتار
    POST  https://internal-api.z.ai/v1/chat/completions/vision ← فهم تصویر
    احراز هویت: هدر Authorization: Bearer <apiKey> + X-Token + X-Chat-Id + X-User-Id
    ← همهٔ این‌ها داخل فایل /etc/.z-ai-config هستند (یک فایل = کل دسترسی)
    ⚠️ این آدرس فقط از داخل خود سرور در دسترس است (شبکهٔ خصوصی).

 ▸ اتصال ابزارهای کدنویسی (OpenCode / Cline / هر ابزار OpenAI-سازگار) از بیرون سرور:
    بیس‌یو‌آر‌ال: <همان آدرس پنل>/api/openai/v1
    کلید API: از تب «API و اتصال» پنل کپی کن (یا OPENAI_PROXY_KEY در .secrets/panel.env)
    مدل‌ها: glm-4.7 (سریع) / glm-4.7-thinking (اندیشمند)
    مانیتور خودکار: هر تغییر/قطعی API → سیو مسیج تلگرام (سرویس monitor).

 ▸ ساده‌ترین راه (وقتی پنل زنده است): خود پنل → تب «چت» → دستور مستقیم
    «تصویر: …» یا «ویدیو: … | مدت | کیفیت | صدا | عمودی | فریم ۶۰»

 ▸ راه اضطراری مستقیم (وقتی پنل مرده است ولی سرور زنده است):
    bash /home/z/my-project/scripts/emergency-api.sh status
    bash /home/z/my-project/scripts/emergency-api.sh chat "پیام"
    bash /home/z/my-project/scripts/emergency-api.sh image "پرامپت" out.jpg
    bash /home/z/my-project/scripts/emergency-api.sh video "پرامپت" 5 speed out.mp4

 ▸ اگر API جواب ۴۲۹ داد: محدودیت نرخ سمت provider است — سیستم خودش با
   backoff پلکانی صبر می‌کند و خودکار برمی‌گردد؛ خودت هم چند دقیقه صبر کن.

 ▸ اگر 401/403 داد: کانفیگ خراب شده — نسخهٔ پشتیبان را برگردان:
    sudo cp /home/z/my-project/.secrets/z-ai-config.json /etc/.z-ai-config

 ▸ راهنمای کامل: /home/z/my-project/EMERGENCY-API.md
EOS
}

# ── dispatch ──────────────────────────────────────────────────────────
case "${1:-}" in
  status) cmd_status ;;
  chat)   shift; cmd_chat "$@" ;;
  image)  shift; cmd_image "$@" ;;
  video)  shift; cmd_video "$@" ;;
  paths)  cmd_paths ;;
  card|"") cmd_card ;;
  *) die "دستور ناشناخته: $1 — مجاز: status | chat | image | video | paths | card" ;;
esac
