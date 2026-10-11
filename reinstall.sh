#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  🔄 CiaNet REINSTALL — Full clean reinstall (preserves secrets)
#
#  Use this when your panel is broken/mixed state. It:
#  1. Stops all services
#  2. Backs up .secrets + db + tg-tools to /tmp/cianet-backup
#  3. Wipes ~/my-project + ~/tg-tools + ~/agent-repo
#  4. Downloads fresh code from GitHub
#  5. Restores secrets
# 6. Installs everything clean
#  7. Starts all services
#
#  Usage:  bash <(curl -fsSL https://raw.githubusercontent.com/CiaNetIR/agent/main/reinstall.sh)
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; C='\033[1;36m'; B='\033[1m'; NC='\033[0m'
say()  { echo -e "${G}[$(date '+%H:%M:%S')] $*${NC}"; }
warn() { echo -e "${Y}⚠ $*${NC}"; }
err()  { echo -e "${R}✗ $*${NC}" >&2; exit 1; }
step() { echo -e "${C}▶ $*${NC}"; }

ROOT="${HOME:-/root}"
PROJECT="$ROOT/my-project"
TG_TOOLS="$ROOT/tg-tools"
MIRROR="$ROOT/agent-repo"
BACKUP="/tmp/cianet-backup-$(date +%s)"

echo ""
echo -e "${C}══════════════════════════════════════════${NC}"
echo -e "${C}  🔄 CiaNet REINSTALL (preserves secrets)${NC}"
echo -e "${C}══════════════════════════════════════════${NC}"
echo ""

# ── PATH setup ──
export PATH="$ROOT/.bun/bin:$PATH"

# ────────────────────────────────────────────────────────────────────
# 0. PRE-FLIGHT
# ────────────────────────────────────────────────────────────────────
say "0 — بررسی پیش‌نیازها"
[ "$(id -u)" -eq 0 ] || err "باید با root اجرا شود: sudo bash reinstall.sh"

# Check bun
if ! command -v bun >/dev/null 2>&1; then
  say "  bun نصب نیست — در حال نصب..."
  curl -fsSL https://bun.sh/install | bash || err "نصب bun ناموفق"
  export PATH="$ROOT/.bun/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 || err "bun در PATH نیست"
say "  ✓ bun $(bun --version)"

# Check node 20+
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
  if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
    say "  Node $NODE_MAJOR قدیمی است — در حال ارتقا..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
    apt-get install -y -qq nodejs >/dev/null 2>&1 || true
  fi
else
  say "  node نصب نیست — در حال نصب..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
  apt-get install -y -qq nodejs >/dev/null 2>&1 || true
fi
NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
[ "${NODE_MAJOR:-0}" -ge 20 ] || err "Node.js 20 نصب نشد"
say "  ✓ node $(node --version)"

# ────────────────────────────────────────────────────────────────────
# 1. STOP ALL SERVICES
# ────────────────────────────────────────────────────────────────────
say "1 — توقف همه سرویس‌ها"
pkill -9 -f "keepalive.sh" 2>/dev/null || true
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
pkill -9 -f "bun run dev" 2>/dev/null || true
pkill -9 -f "watcher.py" 2>/dev/null || true
pkill -9 -f "watcher/supervisor" 2>/dev/null || true
pkill -9 -f "node.*index.mjs" 2>/dev/null || true
bash "$PROJECT/mini-services/agent/agent_ctl.sh" stop 2>/dev/null || true
bash "$PROJECT/mini-services/terminal/term_ctl.sh" stop 2>/dev/null || true
sleep 3
say "  ✓ همه سرویس‌ها متوقف شدند"

# ────────────────────────────────────────────────────────────────────
# 2. BACKUP SECRETS + DB + CONFIGS
# ────────────────────────────────────────────────────────────────────
say "2 — بکاپ‌گیری از secrets و دیتابیس"
mkdir -p "$BACKUP"

# Backup .secrets
if [ -d "$PROJECT/.secrets" ]; then
  cp -r "$PROJECT/.secrets" "$BACKUP/"
  say "  ✓ .secrets بکاپ شد"
fi

# Backup database
if [ -f "$PROJECT/db/custom.db" ]; then
  mkdir -p "$BACKUP/db"
  cp "$PROJECT/db/custom.db" "$BACKUP/db/"
  say "  ✓ دیتابیس بکاپ شد"
fi

# Backup watcher state
if [ -d "$TG_TOOLS/watcher" ]; then
  mkdir -p "$BACKUP/watcher"
  cp "$TG_TOOLS/watcher/state.json" "$BACKUP/watcher/" 2>/dev/null || true
  cp "$TG_TOOLS/watcher/wlog.jsonl" "$BACKUP/watcher/" 2>/dev/null || true
  cp "$TG_TOOLS/watcher/config.json" "$BACKUP/watcher/" 2>/dev/null || true
  say "  ✓ وضعیت واتچر بکاپ شد"
fi

# Backup llm.env
if [ -f "$PROJECT/.secrets/llm.env" ]; then
  say "  ✓ llm.env موجود است"
fi

echo -e "  ${B}بکاپ در: $BACKUP${NC}"

# ────────────────────────────────────────────────────────────────────
# 3. WIPE OLD FILES
# ────────────────────────────────────────────────────────────────────
say "3 — پاک‌سازی فایل‌های قدیمی"
rm -rf "$PROJECT" "$TG_TOOLS" "$MIRROR"
sleep 1
say "  ✓ پاک شد"

# ────────────────────────────────────────────────────────────────────
# 4. DOWNLOAD FRESH CODE FROM GITHUB
# ────────────────────────────────────────────────────────────────────
say "4 — دریافت کد تازه از GitHub"
cd /tmp
rm -f agent.zip agent-main
if curl -fsSL "https://github.com/CiaNetIR/agent/archive/refs/heads/main.zip" -o agent.zip 2>/dev/null; then
  unzip -o -q agent.zip
  mv agent-main "$MIRROR"
  say "  ✓ کد از GitHub دریافت شد"
else
  err "دانلود از GitHub ناموفق — شبکه را بررسی کن"
fi

# ────────────────────────────────────────────────────────────────────
# 5. COPY FILES TO LIVE LOCATIONS
# ────────────────────────────────────────────────────────────────────
say "5 — کپی فایل‌ها"
mkdir -p "$PROJECT" "$TG_TOOLS/watcher/sendq"
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude upload --exclude dev.log --exclude tool-results \
  "$MIRROR/my-project/" "$PROJECT/"
rsync -a "$MIRROR/tg-tools/" "$TG_TOOLS/"
cp "$MIRROR/keepalive.sh" "$ROOT/keepalive.sh" 2>/dev/null || true
chmod +x "$TG_TOOLS"/watcher/*.sh "$TG_TOOLS"/*.sh 2>/dev/null || true
say "  ✓ فایل‌ها کپی شدند"

# ────────────────────────────────────────────────────────────────────
# 6. RESTORE SECRETS + DB
# ────────────────────────────────────────────────────────────────────
say "6 — بازیابی secrets و دیتابیس"
if [ -d "$BACKUP/.secrets" ]; then
  rm -rf "$PROJECT/.secrets"
  cp -r "$BACKUP/.secrets" "$PROJECT/.secrets"
  chmod -R go-rwx "$PROJECT/.secrets" 2>/dev/null || true
  say "  ✓ .secrets بازیابی شد"
else
  warn "  .secrets بکاپ نبود — فایل‌های تمپلیت استفاده می‌شن"
fi

if [ -d "$BACKUP/db" ]; then
  mkdir -p "$PROJECT/db"
  cp "$BACKUP/db/custom.db" "$PROJECT/db/" 2>/dev/null || true
  say "  ✓ دیتابیس بازیابی شد"
fi

if [ -d "$BACKUP/watcher" ]; then
  cp "$BACKUP/watcher/state.json" "$TG_TOOLS/watcher/" 2>/dev/null || true
  cp "$BACKUP/watcher/wlog.jsonl" "$TG_TOOLS/watcher/" 2>/dev/null || true
  cp "$BACKUP/watcher/config.json" "$TG_TOOLS/watcher/" 2>/dev/null || true
  say "  ✓ وضعیت واتچر بازیابی شد"
fi

# ────────────────────────────────────────────────────────────────────
# 7. .env + AUTO-LOGIN PATCHES
# ────────────────────────────────────────────────────────────────────
say "7 — ساخت .env و اعمال پچ‌ها"
echo "DATABASE_URL=file:$PROJECT/db/custom.db" > "$PROJECT/.env"

# proxy.ts (pass-through)
cat > "$PROJECT/src/proxy.ts" <<'EOF'
import { NextRequest, NextResponse } from "next/server";
export function proxy(_request: NextRequest) { return NextResponse.next(); }
export const config = { matcher: "/:path*" };
EOF

# verifyKey → always true (auto-login)
python3 -c "
import re
p = '$PROJECT/src/lib/panel-server.ts'
with open(p) as f: c = f.read()
c = re.sub(r'export function verifyKey\(hashHex: unknown\): boolean \{.*?\n\}', 'export function verifyKey(hashHex: unknown): boolean {\n  registerSuccess()\n  return true\n}', c, count=1, flags=re.DOTALL)
with open(p, 'w') as f: f.write(c)
" 2>/dev/null && say "  ✓ پچ verifyKey اعمال شد" || warn "پچ verifyKey اعمال نشد"

# agent checkPanelAuth → always true
python3 -c "
import re
p = '$PROJECT/mini-services/agent/lib.ts'
with open(p) as f: c = f.read()
c = re.sub(r'export function checkPanelAuth\(key: string \| undefined\): boolean \{.*?\n\}', 'export function checkPanelAuth(key: string | undefined): boolean {\n  return true\n}', c, count=1, flags=re.DOTALL)
with open(p, 'w') as f: f.write(c)
" 2>/dev/null && say "  ✓ پچ agent auth اعمال شد" || warn "پچ agent auth اعمال نشد"

# Disable panel password
sed -i 's|^PANEL_PASSWORD_SHA256=.*|PANEL_PASSWORD_SHA256=|' "$PROJECT/.secrets/panel.env" 2>/dev/null || true

# ────────────────────────────────────────────────────────────────────
# 8. ENABLE WEBPACK (avoid Turbopack corruption)
# ────────────────────────────────────────────────────────────────────
say "8 — فعال‌سازی webpack"
cd "$PROJECT"
if ! grep -q '\-\-webpack' package.json; then
  sed -i 's|"dev": "next dev -p 3000|"dev": "next dev -p 3000 --webpack|' package.json
fi
say "  ✓ webpack فعال شد"

# ────────────────────────────────────────────────────────────────────
# 9. INSTALL DEPENDENCIES
# ────────────────────────────────────────────────────────────────────
say "9 — نصب وابستگی‌ها (۲-۴ دقیقه)"
cd "$PROJECT" && bun install 2>&1 | tail -3 || err "bun install ناموفق"
cd "$PROJECT/mini-services/agent" && bun install 2>&1 | tail -2 || warn "agent install ناموفق"
cd "$PROJECT/mini-services/terminal" && bun install 2>&1 | tail -2 || warn "terminal install ناموفق"
cd "$PROJECT" && bunx prisma generate 2>&1 | tail -2 || err "prisma generate ناموفق"
bunx prisma db push --accept-data-loss 2>&1 | tail -2 || err "prisma db push ناموفق"
say "  ✓ وابستگی‌ها نصب شدند"

# ────────────────────────────────────────────────────────────────────
# 10. PYTHON + TELETHON + PySocks + z-ai
# ────────────────────────────────────────────────────────────────────
say "10 — نصب پایتون + telethon + PySocks"
[ -x "$ROOT/.venv/bin/python" ] || python3 -m venv "$ROOT/.venv" 2>/dev/null
"$ROOT/.venv/bin/pip" install -q telethon PySocks 2>&1 | tail -2 || warn "telethon/PySocks ناموفق"
say "  ✓ پایتون آماده شد"

say "10.5 — نصب z-ai CLI"
if ! command -v z-ai >/dev/null 2>&1; then
  npm install -g z-ai-web-dev-sdk 2>/dev/null || true
  [ -x "$ROOT/.bun/bin/z-ai" ] && ln -sf "$ROOT/.bun/bin/z-ai" /usr/local/bin/z-ai 2>/dev/null || true
fi
command -v z-ai >/dev/null 2>&1 && say "  ✓ z-ai نصب شد" || warn "z-ai نصب نشد"

# ────────────────────────────────────────────────────────────────────
# 10.6. DETECT PROXY
# ────────────────────────────────────────────────────────────────────
say "10.6 — تشخیص پروکسی تلگرام"
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
  say "  ✓ پروکسی: $PROXY_FOUND"
  if ! grep -q "TELEGRAM_PROXY" "$PROJECT/.secrets/tg.env" 2>/dev/null; then
    echo "TELEGRAM_PROXY=$PROXY_FOUND" >> "$PROJECT/.secrets/tg.env" 2>/dev/null || true
  fi
  # Also set LLM_PROXY in llm.env (so Node.js fetch uses proxy for Groq/OpenRouter)
  if [ -f "$PROJECT/.secrets/llm.env" ]; then
    if ! grep -q "^LLM_PROXY=" "$PROJECT/.secrets/llm.env" 2>/dev/null; then
      echo "LLM_PROXY=$PROXY_FOUND" >> "$PROJECT/.secrets/llm.env"
    else
      sed -i "s|^LLM_PROXY=.*|LLM_PROXY=$PROXY_FOUND|" "$PROJECT/.secrets/llm.env"
    fi
  fi
else
  say "  ℹ پروکسی پیدا نشد"
fi

# ────────────────────────────────────────────────────────────────────
# 11. START SERVICES
# ────────────────────────────────────────────────────────────────────
say "11 — استارت پنل (:3000)"
cd "$PROJECT" && rm -rf .next
setsid --fork bash -c "cd '$PROJECT' && exec bun run dev" </dev/null >/dev/null 2>&1

step "صبر برای کامپایل webpack (حداکثر ۳ دقیقه)..."
PANEL_READY=false
for i in $(seq 1 18); do
  sleep 10
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:3000/ 2>/dev/null || echo "000")
  echo -e "  [$i/18 — $((i*10))s] HTTP: ${code}"
  if [ "$code" = "200" ]; then
    PANEL_READY=true
    break
  fi
  if [ "$code" = "500" ] && [ "$i" = "3" ]; then
    warn "خطای 500 — پاک‌سازی و ری‌استارت..."
    pkill -9 -f "next dev" 2>/dev/null || true
    sleep 2
    rm -rf "$PROJECT/.next"
    setsid --fork bash -c "cd '$PROJECT' && exec bun run dev" </dev/null >/dev/null 2>&1
  fi
done
[ "$PANEL_READY" = "true" ] && say "  ✓ پنل آماده (HTTP 200)" || { tail -30 "$PROJECT/dev.log" 2>/dev/null; err "پنل بالا نیامد"; }

say "11.5 — استارت ایجنت و ترمینال"
bash "$PROJECT/mini-services/agent/agent_ctl.sh" start 2>&1 | tail -2 || warn "agent شروع نشد"
sleep 3
bash "$PROJECT/mini-services/terminal/term_ctl.sh" start 2>&1 | tail -2 || warn "terminal شروع نشد"
sleep 3

# ────────────────────────────────────────────────────────────────────
# 12. START WATCHER (with proxy)
# ────────────────────────────────────────────────────────────────────
say "12 — استارت واتچر تلگرام"
if [ -f "$PROJECT/.secrets/tg.env" ] && grep -q "API_ID" "$PROJECT/.secrets/tg.env" 2>/dev/null; then
  # Read proxy from tg.env
  if [ -n "${PROXY_FOUND:-}" ]; then
    export TELEGRAM_PROXY="$PROXY_FOUND"
  elif grep -q "^TELEGRAM_PROXY=" "$PROJECT/.secrets/tg.env" 2>/dev/null; then
    export TELEGRAM_PROXY=$(grep "^TELEGRAM_PROXY=" "$PROJECT/.secrets/tg.env" | cut -d= -f2-)
  fi
  rm -f "$TG_TOOLS/watcher/PAUSE" 2>/dev/null
  cd "$TG_TOOLS/watcher"
  setsid --fork bash -c 'cd "$TG_TOOLS/watcher" && exec "$ROOT/.venv/bin/python" watcher.py' </dev/null >>service.log 2>&1
  sleep 8
  if pgrep -f "watcher.py" >/dev/null; then
    WPID=$(pgrep -f "watcher.py" | head -1)
    echo "$WPID" > "$TG_TOOLS/watcher/watcher.lock"
    say "  ✓ واتچر روشن شد (PID: $WPID)"
  else
    warn "  واتچر شروع نشد — لاگ:"
    tail -15 "$TG_TOOLS/watcher/service.log" 2>/dev/null
  fi
else
  warn "  واتچر شروع نشد (tg.env کامل نیست)"
fi

# ────────────────────────────────────────────────────────────────────
# 13. KEEPALIVE DAEMON
# ────────────────────────────────────────────────────────────────────
say "13 — فعال‌سازی keepalive"
cat > "$ROOT/keepalive.sh" <<'KA'
#!/bin/bash
export PATH="$HOME/.bun/bin:$PATH"
LOG=$HOME/keepalive.log
say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
say "keepalive started (pid $$)"
while true; do
  if ! curl -s -m 6 -o /dev/null http://localhost:3000/ 2>/dev/null; then
    say "panel down — restarting..."
    pkill -9 -f "next dev" 2>/dev/null
    pkill -9 -f "next-server" 2>/dev/null
    sleep 3
    rm -rf $HOME/my-project/.next
    setsid --fork bash -c 'export PATH="$HOME/.bun/bin:$PATH"; cd $HOME/my-project && exec bun run dev' </dev/null >/dev/null 2>&1
  fi
  curl -s -m 5 http://localhost:3004/healthz >/dev/null 2>&1 || bash $HOME/my-project/mini-services/agent/agent_ctl.sh start >>"$LOG" 2>&1
  curl -s -m 5 -o /dev/null http://localhost:3001/ 2>/dev/null || bash $HOME/my-project/mini-services/terminal/term_ctl.sh start >>"$LOG" 2>&1
  if ! pgrep -f "watcher.py" >/dev/null; then
    if [ -f "$HOME/my-project/.secrets/tg.env" ]; then
      export TELEGRAM_PROXY=$(grep "^TELEGRAM_PROXY=" "$HOME/my-project/.secrets/tg.env" 2>/dev/null | cut -d= -f2- || echo "")
    fi
    setsid --fork bash -c 'cd $HOME/tg-tools/watcher && exec $HOME/.venv/bin/python watcher.py' </dev/null >>$HOME/tg-tools/watcher/service.log 2>&1
    sleep 5
    WPID=$(pgrep -f "watcher.py" | head -1)
    [ -n "$WPID" ] && echo "$WPID" > $HOME/tg-tools/watcher/watcher.lock
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
# 14. Install/Refresh systemd services (auto-start after reboot)
# ────────────────────────────────────────────────────────────────────
say "14 — نصب systemd services (auto-start بعد reboot)"
cat > /etc/systemd/system/cianet-panel.service <<EOF
[Unit]
Description=CiaNet Panel (Next.js)
After=network.target
[Service]
Type=simple
User=root
Environment=PATH=$ROOT/.bun/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=$ROOT
WorkingDirectory=$PROJECT
ExecStart=$ROOT/.bun/bin/bun run dev
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/cianet-agent.service <<EOF
[Unit]
Description=CiaNet Agent (:3004)
After=network.target cianet-panel.service
[Service]
Type=simple
User=root
Environment=PATH=$ROOT/.bun/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=$ROOT
WorkingDirectory=$PROJECT/mini-services/agent
ExecStart=$ROOT/.bun/bin/bun run index.ts
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/cianet-terminal.service <<EOF
[Unit]
Description=CiaNet Terminal (:3001)
After=network.target
[Service]
Type=simple
User=root
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=HOME=$ROOT
WorkingDirectory=$PROJECT/mini-services/terminal
ExecStart=/usr/bin/node index.mjs
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/cianet-watcher.service <<EOF
[Unit]
Description=CiaNet Telegram Watcher (@VpnStarZ)
After=network.target
[Service]
Type=simple
User=root
Environment=HOME=$ROOT
Environment=TELEGRAM_PROXY=${PROXY_FOUND:-socks5://127.0.0.1:10808}
WorkingDirectory=$TG_TOOLS/watcher
ExecStart=$ROOT/.venv/bin/python watcher.py
Restart=always
RestartSec=15
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/cianet-keepalive.service <<EOF
[Unit]
Description=CiaNet Keepalive Daemon
After=network.target cianet-panel.service cianet-agent.service cianet-terminal.service cianet-watcher.service
[Service]
Type=simple
User=root
Environment=PATH=$ROOT/.bun/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=$ROOT
ExecStart=$ROOT/keepalive.sh
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable cianet-panel cianet-agent cianet-terminal cianet-watcher cianet-keepalive 2>&1 | tail -5
say "  ✓ systemd services نصب شد"

# ────────────────────────────────────────────────────────────────────
# FINAL REPORT
# ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C}══════════════════════════════════════════${NC}"
echo -e "${G}  ✅ نصب کامل شد!${NC}"
echo -e "${C}══════════════════════════════════════════${NC}"
echo ""

echo -e "${B}وضعیت سرویس‌ها:${NC}"
code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 http://localhost:3000/ 2>/dev/null)
[ "$code" = "200" ] && echo -e "  پنل :3000       → ${G}✓ HTTP 200${NC}" || echo -e "  پنل :3000       → ${R}✗ HTTP $code${NC}"

agent_health=$(curl -s -m 5 http://localhost:3004/healthz 2>/dev/null | head -c 60)
[ -n "$agent_health" ] && echo -e "  ایجنت :3004     → ${G}✓ $agent_health${NC}" || echo -e "  ایجنت :3004     → ${R}✗ خاموش${NC}"

code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:3001/ 2>/dev/null)
echo -e "  ترمینال :3001   → ${G}✓ HTTP $code${NC}"

pgrep -f "watcher.py" >/dev/null && echo -e "  واتچر           → ${G}✓ فعال${NC}" || echo -e "  واتچر           → ${Y}⚠ خاموش${NC}"

pgrep -f "keepalive.sh" >/dev/null && echo -e "  keepalive       → ${G}✓ فعال${NC}" || echo -e "  keepalive       → ${R}✗ خاموش${NC}"

echo ""
echo -e "${B}نسخه‌ها:${NC}"
echo -e "  Node.js: $(node --version)"
echo -e "  Bun:     $(bun --version 2>/dev/null || echo 'نامشخص')"

echo ""
echo -e "${B}بکاپ در:${NC} $BACKUP"
echo -e "${B}پروژه:${NC} $PROJECT"
echo ""
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo -e "${B}آدرس پنل:${NC}"
echo -e "  ${G}http://localhost:3000${NC}"
[ -n "$LOCAL_IP" ] && echo -e "  ${G}http://${LOCAL_IP}:3000${NC}"
echo ""
echo -e "${C}🚀 CiaNet آماده استفاده است!${NC}"
echo -e "${C}══════════════════════════════════════════${NC}"
