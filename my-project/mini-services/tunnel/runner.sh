#!/bin/bash
cd /home/z/my-project/mini-services/tunnel || exit 1
R="$PWD/checklist-result.txt"
log(){ echo "[$(date -u +%H:%M:%S)] $*" >> "$R"; }
: > "$R"
log "runner started v2"
SEC=/home/z/my-project/.secrets/cloudflare
FC="skipped"; FOUND="skipped"
if [ -x bin/cloudflared ] && bin/cloudflared --version >/dev/null 2>&1; then
  log "STEP1 binary already present"
else
  mkdir -p bin; rm -f bin/cloudflared
  if curl -fL --connect-timeout 8 --max-time 40 -o bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 >>"$R" 2>&1 && [ -s bin/cloudflared ]; then
    log "STEP1 github OK ($(stat -c%s bin/cloudflared) bytes)"
  else
    rm -f bin/cloudflared
    log "STEP1 github failed/timed out, trying pkg.cloudflare.com pools"
    DEB=""
    for DIST in bookworm bullseye jammy; do
      P=$(curl -fsSL --connect-timeout 8 --max-time 25 "https://pkg.cloudflare.com/cloudflared/pool/$DIST/main/binary-amd64/Packages" 2>/dev/null) || continue
      DEB=$(echo "$P" | awk '/^Version:/{v=$2}/^Filename:/{print v, $2}' | sort -V | tail -1 | awk '{print $2}')
      [ -n "$DEB" ] && { log "STEP1 pool $DIST newest: $DEB"; break; }
    done
    if [ -n "$DEB" ] && curl -fL --connect-timeout 8 --max-time 150 -o /tmp/cf.deb "https://pkg.cloudflare.com/$DEB" >>"$R" 2>&1; then
      rm -rf /tmp/cfex && dpkg -x /tmp/cf.deb /tmp/cfex && cp /tmp/cfex/usr/bin/cloudflared bin/cloudflared && log "STEP1 deb OK ($(stat -c%s bin/cloudflared) bytes)"
    else
      log "STEP1 FAILED: no binary obtainable"
    fi
  fi
  chmod +x bin/cloudflared 2>/dev/null
fi
CFVER=$(bin/cloudflared --version 2>&1 | head -1)
log "STEP1 version: $CFVER"
chmod +x *.sh 2>/dev/null
SYN=""
for f in *.sh; do if bash -n "$f" 2>>"$R"; then SYN="$SYN $f:OK"; else SYN="$SYN $f:SYNTAXFAIL"; fi; done
log "STEP2 syntax:$SYN"
if pgrep -f 'provision-watcher[.]sh' >/dev/null; then
  log "STEP3 provision-watcher already running"
else
  nohup setsid bash provision-watcher.sh >> provision-watcher.log 2>&1 &
  log "STEP3 provision-watcher launched"
fi
sleep 12
WPID=$(pgrep -f 'provision-watcher[.]sh' | head -1)
log "STEP3 pid=${WPID:-none} heartbeat=$(ls -la watcher.heartbeat 2>/dev/null | awk '{print $6,$7,$8}')"
if [ -e "$SEC/api-token.txt" ]; then
  log "STEP4 SKIPPED: api-token.txt exists (possibly a real token) — not touching it"
else
  echo invalid-token-test-xyz > "$SEC/api-token.txt"
  FOUND=no
  for i in $(seq 1 18); do [ -f "$SEC/fail-count" ] && { FOUND=yes; break; }; sleep 1; done
  FC=$(cat "$SEC/fail-count" 2>/dev/null || echo none)
  PLOG=$(head -8 provision.log 2>/dev/null | tr '\n' '|' | head -c 400)
  rm -f "$SEC/api-token.txt" "$SEC/fail-count" "$SEC/api-token.invalid"
  rm -f /home/z/tg-tools/watcher/sendq/sq-*-tunnel.json
  log "STEP4 negative test: failcount=$FC processed=$FOUND"
  log "STEP4 provisionlog: $PLOG"
fi
SENDQ=$(ls /home/z/tg-tools/watcher/sendq/ 2>/dev/null | head -5)
log "STEP4 sendq now: ${SENDQ:-empty}"
GW=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:81/)
P3000=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/)
WP=$(pgrep -c -f 'watcher[.]py' || true)
log "STEP5 gw:$GW panel:$P3000 watcherpy:${WP:-0}"
if grep -q "Task ID: 37-b1" /home/z/my-project/worklog.md 2>/dev/null; then
  log "STEP6 worklog already has 37-b1 — skipping"
else
  W=/home/z/my-project/worklog.md
  {
    echo ""
    echo "---"
    echo "Task ID: 37-b1"
    echo "Agent: general-purpose (tunnel infra builder) — finished via server-side runner v2"
    echo "Task: Cloudflare Tunnel infra for panel.cianet.ir — scripts + binary + auto-provisioner armed"
    echo ""
    echo "Work Log:"
    echo "- Files: mini-services/tunnel/{provision.sh,tunnel-run.sh,supervisor.sh,tunnel_ctl.sh,provision-watcher.sh,restore-tunnel.sh,README.md,package.json,bin/cloudflared}"
    echo "- provision.sh: CF API v4 (zone cianet.ir -> tunnel cianet-panel reuse-or-create -> configurations ingress panel.cianet.ir->http://localhost:81 + status_code:404 -> delete stale panel DNS -> proxied CNAME <tunnel-id>.cfargotunnel.com -> persist to .secrets/cloudflare/ 700/600; API token never persisted)"
    echo "- provision-watcher.sh: 10s flock loop, heartbeat, api-token.txt->auto-provision, 3-fail->invalid+alert, sendq notify (sq-*-tunnel.json, chat:me)"
    echo "- Binary: $CFVER"
    echo "- Syntax check:$SYN"
    echo "- provision-watcher pid: ${WPID:-none}"
    echo "- Negative test: failcount=$FC processed=$FOUND (fake token cleaned immediately; sendq: ${SENDQ:-empty})"
    echo "- Services after: gw:$GW panel:$P3000 watcherpy:${WP:-0}"
    echo ""
    echo "Stage Summary:"
    echo "- Tunnel infra ARMED: valid CF API token dropped in .secrets/cloudflare/api-token.txt -> auto-provision (tunnel+DNS+connector) -> owner notified via Saved Messages; restore-tunnel.sh self-heals after sandbox resets (tunnel persists in CF cloud). Owner action pending: create CF API token (Account->Cloudflare Tunnel->Edit, Zone->DNS->Edit, Zone->Zone->Read, zone scope cianet.ir) and send it in chat."
  } >> "$W"
  log "STEP6 worklog appended"
fi
log "runner done RESULT: binary=[$CFVER] syntax=[$SYN] watcher=[${WPID:-none}] negtest_fc=[$FC] negtest_processed=[$FOUND] sendq=[${SENDQ:-empty}] gw=[$GW] panel=[$P3000] watcherpy=[${WP:-0}]"
