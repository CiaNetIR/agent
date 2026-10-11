#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  🚀 CiaNet Full Install —一键部署 v2
#  شامل: پنل + ایجنت + ترمینال + واتچر + noVNC + keepalive + LLM Manager
#  Commit: dd1ab4f — Phase 1-6 complete
# ════════════════════════════════════════════════════════════════════
set -euo pipefail
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; NC='\033[0m'
say() { echo -e "${G}[$(date '+%H:%M:%S')] $*${NC}"; }
err() { echo -e "${R}✗ $*${NC}"; exit 1; }

REPO_URL="https://github.com/CiaNetIR/agent.git"
ROOT="${HOME:-/root}"
MIRROR="$ROOT/agent-repo"
PROJECT="$ROOT/my-project"
TG_TOOLS="$ROOT/tg-tools"

echo ""; echo "══════════════════════════════════════════"; echo "  🚀 CiaNet Full Installer v2"; echo "══════════════════════════════════════════"; echo ""

# 1. System packages
say "1/14 — نصب بسته‌های سیستمی"
if command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq curl git python3 python3-pip python3-venv rsync zip unzip wget 2>/dev/null; fi

# 2. Bun
say "2/14 — نصب Bun"
command -v bun >/dev/null || { curl -fsSL https://bun.sh/install | bash 2>/dev/null; export BUN_INSTALL="$HOME/.bun"; export PATH="$BUN_INSTALL/bin:$PATH"; }

# 3. Node
say "3/14 — نصب Node.js"
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null; apt-get install -y -qq nodejs 2>/dev/null; }

# 4. Clone
say "4/14 — کلون ریپو"
[ -d "$MIRROR/.git" ] && { cd "$MIRROR"; git fetch origin main 2>/dev/null; git reset --hard FETCH_HEAD 2>/dev/null; } || { rm -rf "$MIRROR"; git clone --branch main --single-branch "$REPO_URL" "$MIRROR" 2>/dev/null; }
cd "$MIRROR"

# 5. Restore from latest commit
say "5/14 — بازگردانی فایل‌ها"
LATEST=$(git log --oneline -1 | awk '{print $1}')
say "  آخرین کامیت: $LATEST"

# 6. Copy to live
say "6/14 — کپی فایل‌ها"
mkdir -p "$PROJECT" "$TG_TOOLS/watcher/sendq"
rsync -a --delete --exclude node_modules --exclude .next --exclude .git --exclude upload --exclude dev.log --exclude tool-results "$MIRROR/my-project/" "$PROJECT/"
rsync -a "$MIRROR/tg-tools/" "$TG_TOOLS/"
cp "$MIRROR/keepalive.sh" "$ROOT/keepalive.sh" 2>/dev/null
chmod +x "$TG_TOOLS"/watcher/*.sh "$TG_TOOLS"/*.sh 2>/dev/null
chmod -R go-rwx "$PROJECT/.secrets" 2>/dev/null

# 7. .env
say "7/14 — ایجاد .env"
echo "DATABASE_URL=file:$PROJECT/db/custom.db" > "$PROJECT/.env"

# 8. Apply patches
say "8/14 — اعمال پچ‌ها"
cat > "$PROJECT/src/proxy.ts" <<'EOF'
import { NextRequest, NextResponse } from "next/server";
export function proxy(_request: NextRequest) { return NextResponse.next(); }
export const config = { matcher: "/:path*" };
EOF
python3 -c "
import re
p = '$PROJECT/src/lib/panel-server.ts'
with open(p) as f: c = f.read()
c = re.sub(r'export function verifyKey\(hashHex: unknown\): boolean \{.*?\n\}', 'export function verifyKey(hashHex: unknown): boolean {\n  registerSuccess()\n  return true\n}', c, count=1, flags=re.DOTALL)
with open(p, 'w') as f: f.write(c)
" 2>/dev/null
python3 -c "
import re
p = '$PROJECT/mini-services/agent/lib.ts'
with open(p) as f: c = f.read()
c = re.sub(r'export function checkPanelAuth\(key: string \| undefined\): boolean \{.*?\n\}', 'export function checkPanelAuth(key: string | undefined): boolean {\n  return true\n}', c, count=1, flags=re.DOTALL)
with open(p, 'w') as f: f.write(c)
" 2>/dev/null
sed -i 's|^PANEL_PASSWORD_SHA256=.*|PANEL_PASSWORD_SHA256=|' "$PROJECT/.secrets/panel.env" 2>/dev/null

# 9. Install deps
say "9/14 — نصب وابستگی‌ها"
cd "$PROJECT" && bun install 2>/dev/null
cd "$PROJECT/mini-services/agent" && bun install 2>/dev/null
cd "$PROJECT/mini-services/terminal" && bun install 2>/dev/null
cd "$PROJECT" && bunx prisma generate 2>/dev/null
bunx prisma db push --accept-data-loss 2>/dev/null

# 10. Python
say "10/14 — نصب پایتون + telethon"
[ -x "$ROOT/.venv/bin/python" ] || python3 -m venv "$ROOT/.venv" 2>/dev/null
"$ROOT/.venv/bin/pip" install -q telethon websockify 2>/dev/null

# 11. noVNC
say "11/14 — ساخت دسکتاپ noVNC"
VNC_DIR="$PROJECT/mini-services/vnc"
if [ -d "$VNC_DIR" ] && [ -f "$VNC_DIR/setup.sh" ]; then
  VNC_ROOTFS="$ROOT/vnc-rootfs"
  [ -x "$VNC_ROOTFS/bin/sh" ] || { cd "$VNC_DIR"; bash setup.sh 2>/dev/null; [ -d "$VNC_DIR/rootfs" ] && mv "$VNC_DIR/rootfs" "$VNC_ROOTFS" 2>/dev/null; }
  sed -i "s|/home/z/my-project/mini-services/vnc/rootfs|$VNC_ROOTFS|g" "$VNC_DIR/ns-inner.sh" 2>/dev/null
  sed -i "s|/home/z/my-project/mini-services/vnc/rootfs|$VNC_ROOTFS|g" "$VNC_DIR/run-session.sh" 2>/dev/null
  if [ -x "$VNC_ROOTFS/bin/sh" ]; then
    unshare -Ur chroot "$VNC_ROOTFS" /usr/bin/x11vnc -storepasswd Omeedreza1 /root/vnc.pass 2>/dev/null
    cat > "$VNC_ROOTFS/root/start-x.sh" <<'SX'
#!/bin/sh
set -u
export DISPLAY=:99 HOME=/root LANG=C.UTF-8 LC_ALL=C.UTF-8
Xvfb :99 -screen 0 1280x720x24 -ac -nolisten tcp &
sleep 2
dbus-run-session -- xfce4-session &
sleep 4
exec x11vnc -display :99 -rfbauth /root/vnc.pass -forever -shared -noxdamage -noxfixes -noxrecord -nowf -nowcr -cursor arrow -bg -o /root/x11vnc.log -localhost
SX
    chmod +x "$VNC_ROOTFS/root/start-x.sh"
    echo "VNC_PASSWORD=Omeedreza1" > "$PROJECT/.secrets/vnc.env"
  fi
fi

# 12. Start services
say "12/14 — استارت سرویس‌ها"
cd "$PROJECT" && rm -rf .next
setsid --fork bash -c "cd '$PROJECT' && exec bun run dev" </dev/null >/dev/null 2>&1
sleep 15
bash "$PROJECT/mini-services/agent/agent_ctl.sh" start 2>/dev/null
sleep 3
bash "$PROJECT/mini-services/terminal/term_ctl.sh" start 2>/dev/null
sleep 3
if [ -x "$ROOT/vnc-rootfs/bin/sh" ]; then
  pkill -9 -f "vnc/supervisor.sh" 2>/dev/null; sleep 1
  cd "$VNC_DIR"; rm -f supervisor.pid
  setsid --fork bash supervisor.sh </dev/null >/dev/null 2>&1
  sleep 10
fi
cd "$TG_TOOLS/watcher" && bash watcher_ctl.sh start 2>/dev/null
sleep 5

# 13. Keepalive
say "13/14 — فعال‌سازی keepalive"
cat > "$ROOT/keepalive.sh" <<'KA'
#!/bin/bash
LOG=$HOME/keepalive.log
say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
say "keepalive started (pid $$)"
while true; do
  curl -s -m 6 -o /dev/null http://localhost:3000/ || { pkill -9 -f "next dev" 2>/dev/null; pkill -9 -f "next-server" 2>/dev/null; sleep 3; rm -rf $HOME/my-project/.next; setsid --fork bash -c "cd $HOME/my-project && exec bun run dev" </dev/null >/dev/null 2>&1; }
  curl -s -m 5 http://localhost:3004/healthz >/dev/null 2>&1 || bash $HOME/my-project/mini-services/agent/agent_ctl.sh start >>"$LOG" 2>&1
  curl -s -m 5 -o /dev/null http://localhost:3001/ || bash $HOME/my-project/mini-services/terminal/term_ctl.sh start >>"$LOG" 2>&1
  pgrep -f "watcher.py" >/dev/null || (cd $HOME/tg-tools/watcher && bash watcher_ctl.sh start) >>"$LOG" 2>&1
  curl -s -m 5 -o /dev/null http://localhost:6080/ 2>/dev/null || { pkill -9 -f "vnc/supervisor.sh" 2>/dev/null; pkill -9 -f websockify 2>/dev/null; sleep 2; cd $HOME/my-project/mini-services/vnc; rm -f supervisor.pid; setsid --fork bash supervisor.sh </dev/null >/dev/null 2>&1; } >>"$LOG" 2>&1
  sleep 60
done
KA
chmod +x "$ROOT/keepalive.sh"
setsid --fork bash "$ROOT/keepalive.sh" </dev/null >/dev/null 2>&1

# 14. Health check
say "14/14 — بررسی سلامت"
echo ""; echo "══════════════════════════════════════════"
echo "  ✅ نصب کامل شد!"
echo "══════════════════════════════════════════"
echo ""
curl -s -o /dev/null -w "  پنل :3000      → HTTP %{http_code}\n" -m 10 http://localhost:3000/ 2>/dev/null
curl -s -m 5 http://localhost:3004/healthz 2>/dev/null | head -c 40 && echo
curl -s -o /dev/null -w "  ترمینال :3001   → HTTP %{http_code}\n" -m 5 http://localhost:3001/ 2>/dev/null
curl -s -o /dev/null -w "  noVNC :6080     → HTTP %{http_code}\n" -m 5 http://localhost:6080/ 2>/dev/null
pgrep -f "watcher.py" >/dev/null && echo "  واتچر          → ✓" || echo "  واتچر          → ✗"
pgrep -f "keepalive.sh" >/dev/null && echo "  keepalive      → ✓" || echo "  keepalive      → ✗"
echo ""
echo "  🔑 رمزها: پنل=بدون رمز | noVNC=Omeedreza1"
echo "  🌐 آدرس: http://localhost:3000"
echo ""
echo "  🚀 CiaNet آماده استفاده است!"
echo "══════════════════════════════════════════"
