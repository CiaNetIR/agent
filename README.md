# 🚀 CiaNet Agent — سیستم کامل دستیار هوشمند VPN STAR

<div align="center">

![CiaNet](https://img.shields.io/badge/CiaNet-VPN%20STAR-10b981?style=for-the-badge&logo=star)
![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript)
![Bun](https://img.shields.io/badge/Bun-1.3-f9f1e1?style=for-the-badge&logo=bun)
![AI](https://img.shields.io/badge/AI-GLM--4--Plus-8b5cf6?style=for-the-badge&logo=brain)

**سیستم کامل مدیریت VPN STAR — پنل وب + ایجنت هوشمند + واتچر تلگرام + ترمینال + دسکتاپ noVNC**

</div>

---

## ⚡ نصب با یک دستور (روی هر سرور لینوکس)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/CiaNetIR/agent/main/quick-install.sh)
```

این دستور خودکار همه چیز رو نصب می‌کنه:
- ✅ پنل وب (Next.js 16) — پورت 3000
- ✅ ایجنت هوشمند (چت + تصویر + فاکتور) — پورت 3004
- ✅ ترمینال وب (شل داخل مرورگر) — پورت 3001
- ✅ واتچر تلگرام (پاسخ خودکار DM با AI)
- ✅ دسکتاپ noVNC (XFCE) — پورت 6080
- ✅ keepalive (نگه‌دار خودکار سرویس‌ها)
- ✅ LLM خودکار (GLM-4-Plus از Z.ai — بدون نیاز به API key)

---

## 📋 پیش‌نیازها

| مورد | حداقل | توصیه |
|---|---|---|
| **سیستم‌عامل** | Ubuntu 20.04+ | Ubuntu 24.04 |
| **رم** | 2 گیگابایت | 4 گیگابایت |
| **دیسک** | 5 گیگابایت | 10 گیگابایت |
| **CPU** | 1 هسته | 2 هسته |

---

## 🛠️ نصب دستی (مرحله به مرحله)

### ۱. کلون ریپو
```bash
git clone https://github.com/CiaNetIR/agent.git
cd agent
```

### ۲. نصب Bun + Node.js
```bash
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### ۳. نصب وابستگی‌ها
```bash
cd my-project && bun install
cd mini-services/agent && bun install
cd ../terminal && bun install
cd ../..
```

### ۴. تنظیم دیتابیس
```bash
cd my-project
echo "DATABASE_URL=file:$(pwd)/db/custom.db" > .env
bunx prisma generate
bunx prisma db push --accept-data-loss
```

### ۵. نصب پایتون + telethon
```bash
python3 -m venv ~/.venv
~/.venv/bin/pip install telethon websockify
```

### ۶. استارت سرویس‌ها
```bash
cd my-project && setsid --fork bash -c "cd $(pwd) && exec bun run dev" </dev/null >/dev/null 2>&1
bash mini-services/agent/agent_ctl.sh start
bash mini-services/terminal/term_ctl.sh start
cd /home/z/tg-tools/watcher && bash watcher_ctl.sh start
```

### ۷. noVNC دسکتاپ (اختیاری)
```bash
cd mini-services/vnc && bash setup.sh
bash vnc_ctl.sh start
# رمز: Omeedreza1
```

---

## 🧠 سیستم AI (LLM)

سیستم از **GLM-4-Plus** (مدل Z.ai) استفاده می‌کنه:

| قابلیت | توضیح |
|---|---|
| چت ایجنت | گفتگوی هوشمند با مالک |
| واتچر تلگرام | پاسخ خودکار به مشتریان |
| تولید تصویر | دستور «عکس:» |
| تولید ویدیو | دستور «ویدیو:» |
| حالت تفکر | Deep Thinking |
| بینایی | درک تصاویر (GLM-4.5V) |

### تنظیم LLM روی VPS شخصی
فایل `.secrets/llm.env`:
```bash
LLM_PROVIDER=zai  # یا openai یا huggingface
LLM_API_KEY=your-key
LLM_MODEL=glm-4-plus
```

---

## 🌐 دسترسی از بیرون

### باز کردن پورت‌ها
```bash
sudo ufw allow 3000/tcp  # پنل
sudo ufw allow 81/tcp    # گیت‌وی
sudo ufw allow 6080/tcp  # noVNC
```

### Cloudflare Tunnel
```bash
./cloudflared tunnel run --token YOUR_TOKEN
```

---

## 🔑 رمزها

| سرویس | رمز |
|---|---|
| پنل وب | بدون رمز (auto-login) |
| noVNC | Omeedreza1 |
| واتچر | سشن @VpnStarZ |

---

## 🔧 مدیریت سرویس‌ها

```bash
# پنل
pkill -f "next dev"; cd ~/my-project && setsid --fork bash -c "exec bun run dev" </dev/null >/dev/null 2>&1

# ایجنت
bash ~/my-project/mini-services/agent/agent_ctl.sh {start|stop|restart|status}

# ترمینال
bash ~/my-project/mini-services/terminal/term_ctl.sh {start|stop|restart|status}

# واتچر
cd ~/tg-tools/watcher && bash watcher_ctl.sh {start|stop|pause|resume|status}

# noVNC
bash ~/my-project/mini-services/vnc/vnc_ctl.sh {start|stop|restart|status}

# keepalive
pkill -f keepalive.sh; setsid --fork bash ~/keepalive.sh </dev/null >/dev/null 2>&1
```

---

## 📁 ساختار پروژه

```
agent/
├── quick-install.sh          # 🚀 نصب سریع
├── my-project/
│   ├── src/                   # کد پنل
│   ├── prisma/                # Schema
│   ├── db/                    # SQLite
│   ├── .secrets/              # 🔑 سکرت‌ها
│   ├── mini-services/
│   │   ├── agent/             # ایجنت :3004
│   │   ├── terminal/          # ترمینال :3001
│   │   ├── backups/           # بکاپ خودکار
│   │   ├── tunnel/            # Cloudflare
│   │   └── vnc/               # noVNC :6080
│   └── Caddyfile              # گیت‌وی :81
├── tg-tools/                  # واتچر تلگرام
└── recovery/                  # بکاپ‌های نقطه‌ای
```

---

## ❓ سؤالات متداول

**آیا روی VPS شخصی کار می‌کنه؟** — بله، با `quick-install.sh`

**LLM چطور کار می‌کنه؟** — روی Z.ai خودکار. روی VPS، `.secrets/llm.env` رو تنظیم کن.

**Google Colab مناسب؟** — خیر، موقتیه.

**سرور ریست شد؟** — keepalive خودش بالا میاره. یا `bash ~/keepalive.sh`

---

<div align="center">

**🚀 ساخته‌شده با ❤️ در تهران**

[Telegram](https://t.me/VpnStarZ) · [Website](https://cianet.ir) · [GitHub](https://github.com/CiaNetIR)

</div>
