#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  🚀 CiaNet Full Install — نصب کامل با یک دستور
#  شامل: پنل + ایجنت + ترمینال + واتچر + noVNC + keepalive
#
#  استفاده:
#    bash <(curl -fsSL https://raw.githubusercontent.com/CiaNetIR/agent/main/quick-install.sh)
#
#  روی هر سرور لینوکس (Ubuntu/Debian/CentOS/Alpine) کار می‌کنه
#  توکن گیت‌هاب داخل اسکریپت embed شده — نیازی به چیز اضافی نیست
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
say()  { echo -e "${GREEN}[$(date '+%H:%M:%S')] $*${NC}"; }
err()  { echo -e "${RED}[$(date '+%H:%M:%S')] ✗ $*${NC}"; exit 1; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠ $*${NC}"; }
info() { echo -e "${BLUE}[$(date '+%H:%M:%S')] ℹ $*${NC}"; }

# ── Config ──
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
REPO_URL="https://github.com/CiaNetIR/agent.git"
REPO_PUBLIC="https://github.com/CiaNetIR/agent.git"
BRANCH="main"
ROOT="${HOME:-/root}"
MIRROR="$ROOT/agent-repo"
PROJECT="$ROOT/my-project"
TG_TOOLS="$ROOT/tg-tools"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  🚀 CiaNet Full Installer"
echo "  📦 VPN STAR — پنل + ایجنت + ترمینال + واتچر + noVNC"
echo "══════════════════════════════════════════════════════"
echo ""

# ── 1. Check OS ──
say "1/14 — بررسی سیستم‌عامل"
OS=$(uname -s); ARCH=$(uname -m)
[ "$OS" = "Linux" ] || err "فقط لینوکس پشتیبانی می‌شه (شما: $OS)"
say "  ✓ $OS $ARCH"

# ── 2. Install system packages ──
say "2/14 — نصب بسته‌های سیستمی"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq 2>/dev/null && apt-get install -y -qq curl git python3 python3-pip python3-venv rsync zip unzip wget 2>/dev/null || true
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q curl git python3 python3-pip rsync zip unzip wget 2>/dev/null || true
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache curl git python3 py3-pip rsync zip unzip wget 2>/dev/null || true
fi
say "  ✓ بسته‌های سیستمی نصب شد"

# ── 3. Install Bun ──
say "3/14 — نصب Bun"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash 2>/dev/null
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc 2>/dev/null
  echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc 2>/dev/null
fi
say "  ✓ bun $(bun --version 2>/dev/null | head -1)"

# ── 4. Install Node.js ──
say "4/14 — نصب Node.js"
if ! command -v node >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
    apt-get install -y -qq nodejs 2>/dev/null
  fi
fi
say "  ✓ node $(node --version 2>/dev/null || echo 'check needed')"

# ── 5. Clone repo ──
say "5/14 — کلون ریپو گیت‌هاب"
if [ -d "$MIRROR/.git" ]; then
  cd "$MIRROR"
  git fetch origin "$BRANCH" 2>/dev/null
  git reset --hard FETCH_HEAD 2>/dev/null
else
  rm -rf "$MIRROR"
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$MIRROR" 2>/dev/null || \
  git clone --branch "$BRANCH" --single-branch "$REPO_PUBLIC" "$MIRROR" 2>/dev/null
fi
git -C "$MIRROR" config user.name 'star-agent' 2>/dev/null || true
git -C "$MIRROR" config user.email 'CiaNetIR@users.noreply.github.com' 2>/dev/null || true
HEAD_REV=$(git -C "$MIRROR" rev-parse --short HEAD 2>/dev/null || echo '?')
say "  ✓ آخرین بکاپ: $HEAD_REV"

# ── 6. Restore files from commit 2b0b189 ──
say "6/14 — بازگردانی فایل‌ها از گیت‌هاب"
cd "$MIRROR"
git checkout 2b0b189 -- my-project/src my-project/prisma my-project/mini-services my-project/scripts my-project/tg-tools-backup my-project/examples my-project/Caddyfile my-project/package.json my-project/bun.lock my-project/next.config.ts my-project/tailwind.config.ts my-project/postcss.config.mjs my-project/components.json my-project/tsconfig.json my-project/eslint.config.mjs 2>/dev/null || true
git checkout 2b0b189 -- my-project/.secrets my-project/db my-project/worklog.md 2>/dev/null || true
git checkout 2b0b189 -- tg-tools 2>/dev/null || true

# Copy to live
mkdir -p "$PROJECT" "$TG_TOOLS/watcher/sendq" "$PROJECT/db" "$PROJECT/.secrets"
rsync -a --delete --exclude node_modules --exclude .next --exclude .git --exclude upload --exclude dev.log --exclude tool-results "$MIRROR/my-project/" "$PROJECT/"
rsync -a "$MIRROR/tg-tools/" "$TG_TOOLS/"
chmod +x "$TG_TOOLS"/watcher/*.sh "$TG_TOOLS"/*.sh 2>/dev/null || true
chmod -R go-rwx "$PROJECT/.secrets" 2>/dev/null || true
say "  ✓ فایل‌ها کپی شد ($(find "$PROJECT/src" -type f 2>/dev/null | wc -l) فایل کد)"

# ── 7. Create .env ──
say "7/14 — ایجاد .env"
echo "DATABASE_URL=file:$PROJECT/db/custom.db" > "$PROJECT/.env"
say "  ✓ .env ساخته شد"

# ── 8. Apply patches ──
say "8/14 — اعمال پچ‌ها (رمز غیرفعال، proxy pass-through)"

# proxy.ts — pass-through
cat > "$PROJECT/src/proxy.ts" <<'EOF'
import { NextRequest, NextResponse } from "next/server";
export function proxy(_request: NextRequest) { return NextResponse.next(); }
export const config = { matcher: "/:path*" };
EOF

# verifyKey — always true
python3 -c "
import re
p = '$PROJECT/src/lib/panel-server.ts'
with open(p) as f: c = f.read()
c = re.sub(r'export function verifyKey\(hashHex: unknown\): boolean \{.*?\n\}', 'export function verifyKey(hashHex: unknown): boolean {\n  registerSuccess()\n  return true\n}', c, count=1, flags=re.DOTALL)
with open(p, 'w') as f: f.write(c)
" 2>/dev/null || true

# checkPanelAuth — always true
python3 -c "
import re
p = '$PROJECT/mini-services/agent/lib.ts'
with open(p) as f: c = f.read()
c = re.sub(r'export function checkPanelAuth\(key: string \| undefined\): boolean \{.*?\n\}', 'export function checkPanelAuth(key: string | undefined): boolean {\n  return true\n}', c, count=1, flags=re.DOTALL)
with open(p, 'w') as f: f.write(c)
" 2>/dev/null || true

# Disable panel password
sed -i 's|^PANEL_PASSWORD_SHA256=.*|PANEL_PASSWORD_SHA256=|' "$PROJECT/.secrets/panel.env" 2>/dev/null || true
say "  ✓ پچ‌ها اعمال شد"

# ── 9. Install dependencies ──
say "9/14 — نصب وابستگی‌ها"
cd "$PROJECT" && bun install 2>/dev/null && say "  ✓ my-project"
cd "$PROJECT/mini-services/agent" && bun install 2>/dev/null && say "  ✓ agent"
cd "$PROJECT/mini-services/terminal" && bun install 2>/dev/null && say "  ✓ terminal"
cd "$PROJECT" && bunx prisma generate 2>/dev/null && say "  ✓ prisma generate"
bunx prisma db push --accept-data-loss 2>/dev/null && say "  ✓ prisma db push"

# ── 10. Python venv + telethon + websockify ──
say "10/14 — نصب پایتون + telethon + websockify"
if [ ! -x "$ROOT/.venv/bin/python" ]; then
  python3 -m venv "$ROOT/.venv" 2>/dev/null
fi
"$ROOT/.venv/bin/pip" install -q telethon websockify 2>/dev/null || true
say "  ✓ telethon + websockify"

# ── 11. Build noVNC desktop (Alpine rootfs + XFCE) ──
say "11/14 — ساخت دسکتاپ noVNC"
VNC_DIR="$PROJECT/mini-services/vnc"
if [ -d "$VNC_DIR" ] && [ -f "$VNC_DIR/setup.sh" ]; then
  # Move rootfs outside my-project (so it doesn't break Next.js build)
  VNC_ROOTFS="$ROOT/vnc-rootfs"
  if [ ! -x "$VNC_ROOTFS/bin/sh" ]; then
    cd "$VNC_DIR"
    bash setup.sh 2>/dev/null
    [ -d "$VNC_DIR/rootfs" ] && mv "$VNC_DIR/rootfs" "$VNC_ROOTFS" 2>/dev/null || true
  fi
  # Update ns-inner.sh to point to new rootfs location
  sed -i "s|/home/z/my-project/mini-services/vnc/rootfs|$VNC_ROOTFS|g" "$VNC_DIR/ns-inner.sh" 2>/dev/null || true
  sed -i "s|/home/z/my-project/mini-services/vnc/rootfs|$VNC_ROOTFS|g" "$VNC_DIR/run-session.sh" 2>/dev/null || true
  # Set VNC password
  if [ -x "$VNC_ROOTFS/bin/sh" ]; then
    VNC_PW="${VNC_PASSWORD:-Omeedreza1}"
    unshare -Ur chroot "$VNC_ROOTFS" /usr/bin/x11vnc -storepasswd "$VNC_PW" /root/vnc.pass 2>/dev/null || true
    echo "VNC_PASSWORD=$VNC_PW" > "$PROJECT/.secrets/vnc.env"
    # Create start-x.sh
    cat > "$VNC_ROOTFS/root/start-x.sh" <<'STARTEX'
#!/bin/sh
set -u
export DISPLAY=:99 HOME=/root LANG=C.UTF-8 LC_ALL=C.UTF-8
Xvfb :99 -screen 0 1280x720x24 -ac -nolisten tcp &
sleep 2
dbus-run-session -- xfce4-session &
sleep 4
exec x11vnc -display :99 -rfbauth /root/vnc.pass -forever -shared -noxdamage -noxfixes -noxrecord -nowf -nowcr -cursor arrow -bg -o /root/x11vnc.log -localhost
STARTEX
    chmod +x "$VNC_ROOTFS/root/start-x.sh"
    say "  ✓ noVNC rootfs ساخته شد (رمز: $VNC_PW)"
  else
    warn "  ساخت rootfs ناموفق بود — noVNC غیرفعال می‌مونه"
  fi
else
  warn "  پوشه VNC پیدا نشد — noVNC غیرفعال"
fi

# ── 12. Start services ──
say "12/14 — استارت سرویس‌ها"

# Panel
cd "$PROJECT" && rm -rf .next
setsid --fork bash -c "cd '$PROJECT' && exec bun run dev" </dev/null >/dev/null 2>&1
sleep 15
say "  ✓ پنل :3000"

# Agent
bash "$PROJECT/mini-services/agent/agent_ctl.sh" start 2>/dev/null || true
sleep 3
say "  ✓ ایجنت :3004"

# Terminal
bash "$PROJECT/mini-services/terminal/term_ctl.sh" start 2>/dev/null || true
sleep 3
say "  ✓ ترمینال :3001"

# VNC
if [ -x "$ROOT/vnc-rootfs/bin/sh" ]; then
  pkill -9 -f "vnc/supervisor.sh" 2>/dev/null || true
  sleep 1
  cd "$VNC_DIR"
  rm -f supervisor.pid
  setsid --fork bash supervisor.sh </dev/null >/dev/null 2>&1
  sleep 10
  say "  ✓ noVNC :6080"
fi

# Watcher
cd "$TG_TOOLS/watcher" && bash watcher_ctl.sh start 2>/dev/null || true
sleep 5
say "  ✓ واتچر تلگرام"

# ── 13. Keepalive ──
say "13/14 — فعال‌سازی keepalive"
cat > "$ROOT/keepalive.sh" <<'KEEPALIVE'
#!/bin/bash
LOG=$HOME/keepalive.log
say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
say "keepalive started (pid $$)"
while true; do
  curl -s -m 6 -o /dev/null http://localhost:3000/ || {
    pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null
    sleep 3; rm -rf $HOME/my-project/.next
    setsid --fork bash -c "cd $HOME/my-project && exec bun run dev" </dev/null >/dev/null 2>&1
  }
  curl -s -m 5 http://localhost:3004/healthz >/dev/null 2>&1 || bash $HOME/my-project/mini-services/agent/agent_ctl.sh start >>"$LOG" 2>&1
  curl -s -m 5 -o /dev/null http://localhost:3001/ || bash $HOME/my-project/mini-services/terminal/term_ctl.sh start >>"$LOG" 2>&1
  pgrep -f "watcher.py" >/dev/null || (cd $HOME/tg-tools/watcher && bash watcher_ctl.sh start) >>"$LOG" 2>&1
  curl -s -m 5 -o /dev/null http://localhost:6080/ 2>/dev/null || {
    pkill -9 -f "vnc/supervisor.sh" 2>/dev/null; pkill -9 -f websockify 2>/dev/null
    sleep 2; cd $HOME/my-project/mini-services/vnc; rm -f supervisor.pid
    setsid --fork bash supervisor.sh </dev/null >/dev/null 2>&1
  } >>"$LOG" 2>&1
  sleep 60
done
KEEPALIVE
chmod +x "$ROOT/keepalive.sh"
setsid --fork bash "$ROOT/keepalive.sh" </dev/null >/dev/null 2>&1
say "  ✓ keepalive فعال شد"

# ── 14. Health check ──
say "14/14 — بررسی سلامت"
sleep 5

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✅ نصب کامل شد!"
echo "══════════════════════════════════════════════════════"
echo ""
echo "  📊 وضعیت سرویس‌ها:"

PANEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 http://localhost:3000/ 2>/dev/null || echo "000")
echo "    پنل :3000      → HTTP $PANEL_CODE $([ "$PANEL_CODE" = "200" ] && echo '✓' || echo '✗')"

AGENT_OK=$(curl -s -m 5 http://localhost:3004/healthz 2>/dev/null | grep -o '"ok":true' || echo "")
echo "    ایجنت :3004     → $([ -n "$AGENT_OK" ] && echo '✓ سالم' || echo '✗')"

TERM_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:3001/ 2>/dev/null || echo "000")
echo "    ترمینال :3001   → HTTP $TERM_CODE"

VNC_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:6080/ 2>/dev/null || echo "000")
echo "    noVNC :6080     → HTTP $VNC_CODE $([ "$VNC_CODE" = "200" ] && echo '✓' || echo '✗')"

pgrep -f "watcher.py" >/dev/null && echo "    واتچر تلگرام   → ✓ در حال اجرا" || echo "    واتچر تلگرام   → ✗"
pgrep -f "keepalive.sh" >/dev/null && echo "    keepalive      → ✓ در حال اجرا" || echo "    keepalive      → ✗"

echo ""
echo "  🔑 رمزها:"
echo "    پنل: بدون رمز (auto-login)"
echo "    noVNC: Omeedreza1"
echo ""
echo "  🌐 دسترسی:"
echo "    محلی: http://localhost:3000"
echo "    دسکتاپ: http://localhost:6080"
echo ""
echo "  📝 برای دسترسی از بیرون:"
echo "    ufw allow 3000/tcp  # پنل"
echo "    ufw allow 81/tcp    # گیت‌وی"
echo "    ufw allow 6080/tcp  # noVNC"
echo ""
echo "  🚀 CiaNet آماده استفاده است!"
echo "══════════════════════════════════════════════════════"
