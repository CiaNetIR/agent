# 📕 راهنمای کامل مالک — CiaNet Agent Panel

> **آخرین به‌روزرسانی:** ۲۰۲۶-۱۰-۱۱  
> **نسخه:** v3 (Stable)  
> **ریپو:** https://github.com/CiaNetIR/agent

---

## 🚀 نصب یک‌مرحله‌ای (روی سرور تازه)

روی هر سرور لینوکس Ubuntu/Debian با دسترسی root:

```bash
curl -fsSL https://raw.githubusercontent.com/CiaNetIR/agent/main/quick-install.sh | bash
```

اسکریپت خودکار این‌ها رو نصب می‌کنه:
- Node.js 20+ (الزامی برای Next.js 16)
- Bun (package manager)
- پایتون + Telethon + PySocks (برای واتچر تلگرام)
- z-ai CLI (برای پاسخ‌گویی واتچر)
- پروکسی تلگرام (تشخیص خودکار پورت‌های رایج v2ray/xray/clash)
- پنل + ایجنت + ترمینال + واتچر + keepalive

**مدت زمان:** ۳-۵ دقیقه (بسته به سرعت شبکه و سرور)

بعد از نصب، پنل روی `http://SERVER_IP:3000` در دسترسه — بدون رمز (auto-login).

---

## ⚡ نجات فوری (اگه کل سرور از بین رفت)

اگه بکاپ دارید (فایل `z_backup_*.zip` از Saved Messages تلگرام):

```bash
# ۱) نصب اسکریپت رو اجرا کن (همون دستور بالا)
# ۲) بکاپ رو دانلود کن و extract کن
unzip z_backup_YYYY-MM-DD.zip -d /tmp/z-restore

# ۳) فایل‌های سکرت رو برگردون
cp /tmp/z-restore/secrets/tg.env ~/my-project/.secrets/
cp /tmp/z-restore/secrets/watcher-config.json ~/my-project/.secrets/
cp /tmp/z-restore/secrets/panel.env ~/my-project/.secrets/

# ۴) کد واتچر رو برگردون
cp -r /tmp/z-restore/tg-tools/* ~/tg-tools/
chmod +x ~/tg-tools/watcher/*.sh ~/tg-tools/*.sh

# ۵) سرویس‌ها رو ری‌استارت کن
bash ~/my-project/mini-services/agent/agent_ctl.sh restart
bash ~/my-project/mini-services/terminal/term_ctl.sh restart
pkill -f "watcher.py"; sleep 2
cd ~/tg-tools/watcher && bash watcher_ctl.sh start 15
```

---

## 📋 معماری سیستم

### سرویس‌ها و پورت‌ها

| سرویس | پورت | توضیح | دستور مدیریت |
|---|---|---|---|
| پنل وب | 3000 | Next.js 16 + React 19 + Tailwind | `pkill -f "next dev"` |
| ایجنت | 3004 | Bun service — API + چت | `bash ~/my-project/mini-services/agent/agent_ctl.sh restart` |
| ترمینال | 3001 | WebSocket shell (node-pty) | `bash ~/my-project/mini-services/terminal/term_ctl.sh restart` |
| واتچر | — | Python/Telethon — @VpnStarZ | `bash ~/tg-tools/watcher/watcher_ctl.sh restart` |
| keepalive | — | Daemon — هر 60s چک می‌کنه | `pkill -f "keepalive.sh"` |

### فایل‌های کلیدی

```
~/my-project/                          ← پروژه اصلی
├── .secrets/                         ← ⛔ محرمانه
│   ├── tg.env                         ← سشن تلگرام + API + پروکسی
│   ├── watcher-config.json            ← بلاک‌لیست + قوانین دائمی
│   ├── panel.env                      ← رمز پنل (خالی = بدون رمز)
│   ├── llm.env                        ← تنظیمات مدل (OpenRouter/Ollama/...)
│   └── vnc.env                        ← (غیرفعال)
├── mini-services/
│   ├── agent/                         ← سرویس ایجنت (:3004)
│   ├── terminal/                      ← سرویس ترمینال (:3001)
│   └── backups/                       ← بکاپ خودکار
├── prisma/schema.prisma               ← Schema دیتابیس
├── db/custom.db                       ← دیتابیس SQLite
├── src/                               ← کد پنل (Next.js)
└── package.json                       ← وابستگی‌ها

~/tg-tools/                            ← کد واتچر تلگرام
├── watcher/
│   ├── watcher.py                     ← مغز اصلی (شخصیت + منطق)
│   ├── watcher_ctl.sh                 ← دکمه‌های روشن/خاموش
│   ├── supervisor.sh                  ← نگهبان
│   ├── state.json                     ← وضعیت فعلی
│   ├── wlog.jsonl                     ← لاگ رویدادها
│   └── PAUSE                          ← (اگه وجود داشت = متوقف)
├── instances/                         ← اکانت‌های افزوده
├── login_new.py                       ← ورود اکانت جدید
├── send_dm.py                         ← ارسال پیام دستی
├── inspect_dms.py                     ← دیدن پیام‌ها
└── overview_dms.py                    ← خلاصه DMها

~/agent-repo/                          ← آینه GitHub (برای آپدیت)
~/keepalive.sh                         ← daemon نگهبان
```

---

## 🎛 تب‌های پنل

| تب | کاربرد |
|---|---|
| **وضعیت** | آمار واتچر، رویدادهای اخیر، دکمه بکاپ فوری |
| **چت** | گفتگو با دستیار Z (از مدل OpenRouter استفاده می‌کنه) |
| **هوش مصنوعی** | مدیریت Providerهای LLM (OpenRouter, Ollama, vLLM, ...) |
| **ایجنت** | تنظیمات دستیار، شخصیت، قوانین، اسکرپر |
| **اکانت‌ها** | افزودن/حذف اکانت تلگرام (multi-account) |
| **سرویس‌ها** | روشن/خاموش سرویس‌ها، بکاپ خودکار |
| **فایل‌ها** | مرورگر فایل (فقط داخل HOME) |
| **API و اتصال** | توکن‌ها، لاگین تلگرام |
| **ترمینال** | شل لینوکس تحت وب |
| **دسکتاپ** | (غیرفعال — noVNC حذف شده) |
| **تنظیمات** | تم، شخصیت، **بروزرسانی خودکار از GitHub** |
| **سیستم** | ریست/حذف/خاموش‌کردن |
| **راهنما** | همین فایل |

---

## 🤖 تنظیم مدل LLM

### روش ۱: از پنل (پیشنهادی)

1. تب «هوش مصنوعی» رو باز کن
2. «افزودن» رو بزن
3. پر کن:
   - **نوع:** `openai` (برای OpenRouter/Ollama/vLLM/...)
   - **نام:** OpenRouter
   - **Base URL:** `https://openrouter.ai/api/v1`
   - **API Key:** `sk-or-v1-...` (از https://openrouter.ai/keys)
   - **مدل:** `deepseek/deepseek-chat` (یا `meta-llama/llama-3.3-70b-instruct`)
4. «ذخیره» → «تست اتصال»
5. اگه ✓ گرفت، چت پنل کار می‌کنه

### روش ۲: ویرایش مستقیم فایل

```bash
cat > ~/my-project/.secrets/llm.env <<'EOF'
LLM_PROVIDER=openai
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-v1-your-key-here
LLM_MODEL=deepseek/deepseek-chat
LLM_TIMEOUT_MS=90000
EOF

# ری‌استارت ایجنت
bash ~/my-project/mini-services/agent/agent_ctl.sh restart
```

### Providerهای رایگان پیشنهادی

| Provider | Base URL | مدل رایگان |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | `deepseek/deepseek-chat`, `meta-llama/llama-3.3-70b-instruct` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama (محلی) | `http://127.0.0.1:11434/v1` | `llama3.1:8b` (بعد از `ollama pull`) |

---

## 📡 واتچر تلگرام (@VpnStarZ)

### تشخیص خودکار پروکسی

واچر خودکار پروکسی رو از این مکان‌ها پیدا می‌کنه:

1. متغیر محیطی `TELEGRAM_PROXY`
2. فایل `~/my-project/.secrets/tg.env` (خط `TELEGRAM_PROXY=...`)
3. اسکن خودکار پورت‌های رایج: `10808, 10809, 7890, 1080, 2080, 8080`

اگه پروکسی دستی می‌خوای:

```bash
# اضافه کردن به tg.env
echo "TELEGRAM_PROXY=socks5://127.0.0.1:10808" >> ~/my-project/.secrets/tg.env

# یا تنظیم متغیر محیطی
export TELEGRAM_PROXY="socks5://127.0.0.1:10808"
```

### فرمت‌های پشتیبانی‌شده

- `socks5://127.0.0.1:10808` (v2ray/xray)
- `socks4://127.0.0.1:1080`
- `http://127.0.0.1:10809`

### وابستگی‌ها (خودکار نصب می‌شن)

- `telethon` — کلاینت تلگرام
- `PySocks` — پشتیبانی پروکسی
- `z-ai` CLI — برای پاسخ‌گویی LLM

### دستورات واتچر

```bash
~/tg-tools/watcher/watcher_ctl.sh status      # وضعیت
~/tg-tools/watcher/watcher_ctl.sh log 50      # ۵۰ رویداد آخر
~/tg-tools/watcher/watcher_ctl.sh pause       # توقف موقت
~/tg-tools/watcher/watcher_ctl.sh resume 15   # ادامه + جبران ۱۵ دقیقه
~/tg-tools/watcher/watcher_ctl.sh stop        # خاموش کامل
~/tg-tools/watcher/watcher_ctl.sh start 15    # روشن کردن
~/tg-tools/watcher/watcher_ctl.sh expiry      # زمان باقی‌مونده پنجره
```

### فرمان‌های Saved Messages (اتاق فرمان)

به خودت در Saved Messages تلگرام بنویس، Z خودش می‌فهمه:

| می‌خوای | بنویس |
|---|---|
| وضعیت | «وضعیت» |
| بکاپ فوری | «بکاپ بگیر بفرست» |
| قانون جدید | «یادت باشه از این به بعد قیمت X هست» |
| پاک‌کردن قوانین | «همه قوانین رو فراموش کن» |
| بلاک مشتری | «به @username دیگه جواب نده» |
| ارسال پیام | «به @username بگو سرویسش فعال شد» |
| برودکست | «به همه مشتری‌ها بگو تخفیف داریم» → بعد «بله» |

---

## 🔄 بروزرسانی از GitHub

### روش ۱: از پنل (پیشنهادی)

1. تب «تنظیمات» رو باز کن
2. کارت «بروزرسانی پنل» رو پیدا کن
3. «بررسی بروزرسانی» رو بزن
4. اگه نسخه جدید بود، «بروزرسانی کن» رو بزن
5. تایپ کن `بروزرسانی` → تأیید

اسکریپت خودکار:
- git pull از GitHub
- کپی فایل‌ها
- bun install
- prisma db push
- اعمال پچ auto-login
- ری‌استارت سرویس‌ها

### روش ۲: دستی

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /tmp && rm -rf agent-main agent.zip
wget -q https://github.com/CiaNetIR/agent/archive/refs/heads/main.zip -O agent.zip
unzip -o -q agent.zip

# کپی فایل‌ها (با حفظ .secrets و دیتابیس)
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude upload --exclude dev.log --exclude tool-results \
  --exclude .secrets \
  agent-main/my-project/ ~/my-project/
rsync -a agent-main/tg-tools/ ~/tg-tools/
chmod +x ~/tg-tools/watcher/*.sh ~/tg-tools/*.sh

# نصب وابستگی‌ها
cd ~/my-project && bun install
cd ~/my-project/mini-services/agent && bun install
cd ~/my-project/mini-services/terminal && bun install
cd ~/my-project && bunx prisma generate && bunx prisma db push --accept-data-loss

# ری‌استارت
pkill -9 -f "next dev"; sleep 2; rm -rf ~/my-project/.next
setsid --fork bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd ~/my-project && exec bun run dev' </dev/null >/dev/null 2>&1
bash ~/my-project/mini-services/agent/agent_ctl.sh restart
bash ~/my-project/mini-services/terminal/term_ctl.sh restart

# واتچر (با پروکسی)
pkill -f "watcher.py" 2>/dev/null; sleep 2
export TELEGRAM_PROXY=$(grep "^TELEGRAM_PROXY=" ~/my-project/.secrets/tg.env | cut -d= -f2-)
cd ~/tg-tools/watcher
setsid --fork bash -c 'export TELEGRAM_PROXY="'"$TELEGRAM_PROXY"'"; cd ~/tg-tools/watcher && exec ~/.venv/bin/python watcher.py' </dev/null >>service.log 2>&1
```

---

## 🔧 رفع اشکال (Troubleshooting)

### مشکل: پنل بالا نمیاد (HTTP 000/500)

```bash
# بررسی لاگ
tail -50 ~/my-project/dev.log

# پاک‌سازی cache و ری‌استارت
pkill -9 -f "next dev"; sleep 2
rm -rf ~/my-project/.next
export PATH="$HOME/.bun/bin:$PATH"
setsid --fork bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd ~/my-project && exec bun run dev' </dev/null >/tmp/panel.log 2>&1
sleep 60
curl -sI http://localhost:3000/ | head -3
```

### مشکل: واتچر خاموشه

```bash
# بررسی لاگ
tail -30 ~/tg-tools/watcher/service.log
tail -20 ~/tg-tools/watcher/wlog.jsonl

# بررسی پروکسی
curl -s -m 3 --socks5 127.0.0.1:10808 http://example.com && echo "✓ پروکسی کار می‌کنه"

# اجرای مستقیم برای دیدن خطا
export TELEGRAM_PROXY="socks5://127.0.0.1:10808"
cd ~/tg-tools/watcher
timeout 10 ~/.venv/bin/python watcher.py 2>&1 | head -20
```

### مشکل: ترمینال کار نمی‌کنه

```bash
# rebuild node-pty
export PATH="$HOME/.bun/bin:$PATH"
apt-get install -y build-essential python3-dev
cd ~/my-project/mini-services/terminal
rm -rf node_modules package-lock.json bun.lock
bun install 2>&1 | tail -5
ls node_modules/node-pty/build/Release/*.node && echo "✓ native module OK"
bash term_ctl.sh restart
```

### مشکل: چت پنل خطای مدل میده

```bash
# بررسی تنظیمات
cat ~/my-project/.secrets/llm.env
# اگه خالیه، تنظیمش (بخش LLM بالا رو ببین)

# تست مستقیم API
curl -s -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/deepseek-chat","messages":[{"role":"user","content":"hi"}]}' \
  | head -c 200

# ری‌استارت ایجنت
bash ~/my-project/mini-services/agent/agent_ctl.sh restart
```

### مشکل: `bun: command not found`

```bash
# راه‌حل دائمی
ln -sf ~/.bun/bin/bun /usr/local/bin/bun
ln -sf ~/.bun/bin/bunx /usr/local/bin/bunx
hash -r

# یا در ~/.bashrc
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### مشکل: Node.js قدیمیه

```bash
node --version
# اگه <20 بود:
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

---

## 🛡 امنیت

### قوانین طلایی

1. **فایل `.secrets/` رو به هیچ‌کس نده** — کل سیستم توشه
2. **بکاپ zip = کلید کامل اکانتته** — فقط توی Saved Messages بمونه
3. **یه کلاینت بیشتر روی سشن تلگرام نباشه** — قبل کار دستی، `pause` بزن
4. **رمز ۲FA رو به هیچ‌کس نده** — دستیار به اون دسترسی نداره

### تغییر رمز پنل

رمز پنل به‌طور پیش‌فرض خاموشه (auto-login). اگه می‌خوای فعال کنی:

```bash
# تولید hash
echo -n "your-password" | sha256sum | cut -d' ' -f1

# تنظیم در panel.env
echo "PANEL_PASSWORD_SHA256=$(echo -n 'your-password' | sha256sum | cut -d' ' -f1)" > ~/my-project/.secrets/panel.env
```

### خاموش‌کردن کامل سرویس‌ها

```bash
pkill -9 -f "keepalive.sh"
pkill -9 -f "next dev"
pkill -9 -f "next-server"
bash ~/my-project/mini-services/agent/agent_ctl.sh stop
bash ~/my-project/mini-services/terminal/term_ctl.sh stop
pkill -f "watcher.py"
```

---

## 📊 بکاپ‌گیری

### بکاپ فوری (دستی)

```bash
# از پنل: دکمه سبز «بکاپ بگیر و بفرست» در تب وضعیت
# یا از خط فرمان:
touch ~/tg-tools/watcher/BACKUP_NOW
# یا از تلگرام: «بکاپ» در Saved Messages
```

### بکاپ خودکار GitHub

هر ۳۰ دقیقه، کل پروژه (کد + دیتابیس + سکرت‌ها) به GitHub commit می‌شه.

---

## 📞 پشتیبانی

اگه مشکلی داشتی:

1. اول لاگ رو چک کن: `tail -50 ~/my-project/dev.log`
2. وضعیت سرویس‌ها: `bash ~/tg-tools/watcher/watcher_ctl.sh status`
3. اگه حل نشد، فایل لاگ + خروجی `status` رو بفرست

---

**★ VPN | STAR — Z Panel v3 — تهران**
