#!/usr/bin/env bash
# provision-watcher.sh — auto-provisioner for the Cloudflare Tunnel
# (Task 37-b1). Infinite loop, 10s ticks, single instance via flock:
#   • tunnel-token.txt present → make sure the connector runs
#   • api-token.txt present    → run provision.sh once
#       - success: consume the token, start connector, sendq success alert
#       - failure: fail-count++; at 3 → move token to api-token.invalid
#                  + one sendq invalid-token alert + reset counter
#   • neither                   → idle (heartbeat only)
# Owner notifications go ONLY via sendq JSON files — NEVER a second
# Telethon client (the running watcher owns the session):
#   /home/z/tg-tools/watcher/sendq/sq-<epochms>-tunnel.json
#   schema (exact copy of monitor.py): {"chat":"me","text":"..."}
# Logs state CHANGES only — no per-tick spam.
set -u
DIR="/home/z/my-project/mini-services/tunnel"
SECRET_DIR="/home/z/my-project/.secrets/cloudflare"
SENDQ_DIR="/home/z/tg-tools/watcher/sendq"
HEARTBEAT="$DIR/watcher.heartbeat"
LOG="$DIR/provision-watcher.log"
TICK=10

exec 9>/tmp/tunnel-pw.lock
flock -n 9 || { echo "another provision-watcher is already running" >&2; exit 1; }

mkdir -p "$SECRET_DIR" "$SENDQ_DIR" 2>/dev/null || true

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

drop_alert() { # drop_alert <persian text> — same dir + schema as monitor.py
  local ms f
  ms="$(date +%s%3N)"
  while [ -e "$SENDQ_DIR/sq-$ms-tunnel.json" ]; do ms=$((ms + 1)); done
  f="$SENDQ_DIR/sq-$ms-tunnel.json"
  jq -nc '{chat:"me", text:$text}' --arg text "$1" > "$f.tmp"
  mv "$f.tmp" "$f"
  log "sendq alert queued: $(basename "$f")"
}

fail_count() {
  if [ -f "$SECRET_DIR/fail-count" ]; then cat "$SECRET_DIR/fail-count" 2>/dev/null
  else echo 0; fi
}
connector_running() { pgrep -f "cloudflared tunnel[ ]run" >/dev/null 2>&1; }

STATE="init"
log "provision-watcher started (pid $$, ${TICK}s ticks)"
echo "provision-watcher started (pid $$)"

while true; do
  touch "$HEARTBEAT" 2>/dev/null || true

  if [ -s "$SECRET_DIR/tunnel-token.txt" ]; then
    if [ "$STATE" != "have-tunnel" ]; then log "state → have-tunnel (tunnel token present)"; STATE="have-tunnel"; fi
    if ! connector_running; then
      log "tunnel token present but connector down → tunnel_ctl start"
      bash "$DIR/tunnel_ctl.sh" start >> "$LOG" 2>&1
    fi

  elif [ -s "$SECRET_DIR/api-token.txt" ]; then
    if [ "$STATE" != "provisioning" ]; then log "state → provisioning (api-token.txt detected)"; STATE="provisioning"; fi
    APITOK="$(tr -d '[:space:]' < "$SECRET_DIR/api-token.txt" 2>/dev/null || true)"
    if bash "$DIR/provision.sh" "$APITOK" > "$DIR/provision.log" 2>&1; then
      rm -f "$SECRET_DIR/api-token.txt" "$SECRET_DIR/fail-count"
      log "provision OK — api token consumed, fail-count cleared"
      drop_alert "✅ دامنه panel.cianet.ir با موفقیت به سرور وصل شد! پنل الان در مرورگر باز می‌شه: https://panel.cianet.ir"
      log "starting connector"
      bash "$DIR/tunnel_ctl.sh" start >> "$LOG" 2>&1
      STATE="have-tunnel"
    else
      FC=$(( $(fail_count) + 1 ))
      echo "$FC" > "$SECRET_DIR/fail-count"
      log "provision FAILED (attempt $FC/3) — details in provision.log"
      if [ "$FC" -ge 3 ]; then
        mv "$SECRET_DIR/api-token.txt" "$SECRET_DIR/api-token.invalid" 2>/dev/null
        rm -f "$SECRET_DIR/fail-count"
        log "3 failures — api token moved to api-token.invalid, owner alerted"
        drop_alert "❌ اتصال دامنه ناموفق بود — توکن Cloudflare نامعتبره. یه توکن جدید بساز و بفرست."
        STATE="invalid-token"
      fi
    fi

  else
    if [ "$STATE" != "idle" ]; then log "state → idle (no token files; waiting for owner's API token)"; STATE="idle"; fi
  fi

  sleep "$TICK"
done
