#!/usr/bin/env bash
# provision.sh — one-shot Cloudflare Tunnel provisioner for panel.cianet.ir
# (Task 37-b1). Usage: provision.sh <CLOUDFLARE_API_TOKEN>
#
# Creates (or reuses) tunnel "cianet-panel", pushes the remote ingress
# configuration, repoints the panel.cianet.ir DNS CNAME at the tunnel and
# persists everything EXCEPT the API token into
# /home/z/my-project/.secrets/cloudflare/. The API token lives in memory
# only and is NEVER written to any file.
set -euo pipefail

API_TOKEN="${1:-}"
if [ -z "$API_TOKEN" ]; then
  echo "usage: provision.sh <cloudflare-api-token>" >&2
  exit 1
fi

CF_API="https://api.cloudflare.com/client/v4"
SECRET_DIR="/home/z/my-project/.secrets/cloudflare"
ZONE_NAME="cianet.ir"
TUNNEL_NAME="cianet-panel"
DOMAIN="panel.cianet.ir"
ORIGIN="http://localhost:81"

# ── helper: one API call, always gated on .success == true ─────────────
cf() { # cf METHOD PATH [JSON_BODY]  → echoes the response body
  local method="$1" path="$2" body="${3:-}" resp
  if [ -n "$body" ]; then
    resp="$(curl -sS --max-time 60 -X "$method" "$CF_API$path" \
      -H "Authorization: Bearer $API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "$body" || true)"
  else
    resp="$(curl -sS --max-time 60 -X "$method" "$CF_API$path" \
      -H "Authorization: Bearer $API_TOKEN" \
      -H "Content-Type: application/json" || true)"
  fi
  if [ "$(jq -r '.success // false' <<<"$resp" 2>/dev/null || echo false)" != "true" ]; then
    echo "Cloudflare API call failed: $method $path" >&2
    jq -r '.errors[]? | "  code \(.code): \(.message)"' <<<"$resp" 2>/dev/null \
      || echo "  (non-JSON or empty response)" >&2
    exit 1
  fi
  printf '%s\n' "$resp"
}

# ── a) zone + account lookup ───────────────────────────────────────────
echo "[provision] resolving zone $ZONE_NAME ..." >&2
ZONES="$(cf GET "/zones?name=$ZONE_NAME")"
ZONE_ID="$(jq -r '.result[0].id // empty' <<<"$ZONES")"
ACCOUNT_ID="$(jq -r '.result[0].account.id // empty' <<<"$ZONES")"
if [ -z "$ZONE_ID" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "خطا: زون cianet.ir در اکانت Cloudflare پیدا نشد — توکن دسترسی کافی ندارد (Zone → Zone → Read برای cianet.ir لازم است)." >&2
  exit 1
fi
echo "[provision] zone=$ZONE_ID account=$ACCOUNT_ID" >&2

# ── b) tunnel: reuse if a usable connector token exists, else recreate ──
TUNNEL_ID=""
TOKEN=""
SECRET=""
TUNNELS="$(cf GET "/accounts/$ACCOUNT_ID/cfd_tunnel?name=$TUNNEL_NAME&is_deleted=false")"
TUNNEL_ID="$(jq -r '.result[0].id // empty' <<<"$TUNNELS")"
if [ -n "$TUNNEL_ID" ]; then
  echo "[provision] existing tunnel '$TUNNEL_NAME' found ($TUNNEL_ID) — trying to reuse ..." >&2
  DETAIL="$(cf GET "/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID")"
  TOKEN="$(jq -r '.result.token // empty' <<<"$DETAIL")"
  if [ -n "$TOKEN" ] && [[ "$TOKEN" == eyJ* ]]; then
    # connector token = base64(JSON{"a":account,"t":tunnel,"s":secret})
    # → decode the embedded TunnelSecret for the credentials.json fallback
    B64="$(printf '%s' "$TOKEN" | tr '_-' '/+')"
    PAD=$((4 - ${#B64} % 4))
    if [ "$PAD" -eq 4 ]; then PAD=0; fi
    B64="$B64$(printf '%*s' "$PAD" '' | tr ' ' '=')"
    SECRET="$(printf '%s' "$B64" | base64 -d 2>/dev/null | jq -r '.s // empty' 2>/dev/null || true)"
  else
    TOKEN=""
  fi
  if [ -z "$TOKEN" ] || [ -z "$SECRET" ]; then
    echo "[provision] old tunnel has no usable token/secret — deleting and recreating" >&2
    cf DELETE "/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID" >/dev/null
    TUNNEL_ID=""
    TOKEN=""
    SECRET=""
  else
    echo "[provision] reusing tunnel $TUNNEL_ID (connector token OK)" >&2
  fi
fi
if [ -z "$TUNNEL_ID" ]; then
  SECRET="$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)"
  CREATED="$(cf POST "/accounts/$ACCOUNT_ID/cfd_tunnel" \
    "{\"name\":\"$TUNNEL_NAME\",\"config_src\":\"cloudflare\",\"secret\":\"$SECRET\"}")"
  TUNNEL_ID="$(jq -r '.result.id // empty' <<<"$CREATED")"
  TOKEN="$(jq -r '.result.token // empty' <<<"$CREATED")"
  if [ -z "$TUNNEL_ID" ] || [ -z "$TOKEN" ]; then
    echo "tunnel creation returned no id/token" >&2
    exit 1
  fi
  echo "[provision] tunnel '$TUNNEL_NAME' created ($TUNNEL_ID)" >&2
fi

# ── c) remote ingress configuration (cloudflare-managed) ────────────────
echo "[provision] pushing ingress configuration ..." >&2
# NOTE (v2, 2026-10-08): CF configurations API requires the ingress list wrapped
# in a top-level "config" object, and the catch-all must be "http_status:NNN"
# ("status_code:NNN" fails validation: "first path segment in URL cannot contain colon").
cf PUT "/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  "{\"config\":{\"ingress\":[{\"hostname\":\"$DOMAIN\",\"service\":\"$ORIGIN\"},{\"service\":\"http_status:404\"}]}}" >/dev/null
echo "[provision] ingress: $DOMAIN → $ORIGIN (fallback 404)" >&2

# ── d) DNS: replace any existing records for panel.cianet.ir ────────────
echo "[provision] reconciling DNS records for $DOMAIN ..." >&2
DNS_REC="$(cf GET "/zones/$ZONE_ID/dns_records?name=$DOMAIN")"
DELETED=0
while IFS= read -r rec; do
  RID="$(jq -r '.id' <<<"$rec")"
  echo "[provision] deleting old DNS record: $(jq -r '"\(.type) \(.name) → \(.content) (proxied=\(.proxied))"' <<<"$rec")" >&2
  cf DELETE "/zones/$ZONE_ID/dns_records/$RID" >/dev/null
  DELETED=$((DELETED + 1))
done < <(jq -c '.result[]' <<<"$DNS_REC")
echo "[provision] deleted $DELETED old record(s)" >&2
cf POST "/zones/$ZONE_ID/dns_records" \
  "{\"type\":\"CNAME\",\"name\":\"$DOMAIN\",\"content\":\"$TUNNEL_ID.cfargotunnel.com\",\"proxied\":true}" >/dev/null
echo "[provision] CNAME $DOMAIN → $TUNNEL_ID.cfargotunnel.com (proxied)" >&2

# ── e) persist everything (NEVER the API token) ─────────────────────────
mkdir -p "$SECRET_DIR"
chmod 700 "$SECRET_DIR"
umask 177
printf '%s\n' "$TUNNEL_ID"  > "$SECRET_DIR/tunnel-id.txt"
printf '%s\n' "$TOKEN"      > "$SECRET_DIR/tunnel-token.txt"
printf '%s\n' "$ACCOUNT_ID" > "$SECRET_DIR/account-id.txt"
printf '%s\n' "$ZONE_ID"    > "$SECRET_DIR/zone-id.txt"
jq -n --arg a "$ACCOUNT_ID" --arg t "$TUNNEL_ID" --arg s "$SECRET" \
  '{AccountTag:$a, TunnelID:$t, TunnelSecret:$s}' > "$SECRET_DIR/credentials.json"
{
  echo "tunnel: $TUNNEL_ID"
  echo "credentials-file: $SECRET_DIR/credentials.json"
  echo "ingress:"
  echo "  - hostname: $DOMAIN"
  echo "    service: $ORIGIN"
  echo "  - service: http_status:404"
} > "$SECRET_DIR/config.yml"
jq -n --arg t "$TUNNEL_NAME" --arg d "$DOMAIN" --arg at "$(date -u +%FT%TZ)" \
  '{tunnel:$t, domain:$d, at:$at}' > "$SECRET_DIR/provisioned.json"
chmod 600 "$SECRET_DIR"/*
echo "[provision] secrets persisted → $SECRET_DIR (API token NOT saved)" >&2

# ── f) final summary JSON on stdout ────────────────────────────────────
jq -nc --arg tunnel "$TUNNEL_NAME" --arg tunnel_id "$TUNNEL_ID" \
  --arg domain "$DOMAIN" --arg origin "$ORIGIN" --arg zone_id "$ZONE_ID" \
  --arg account_id "$ACCOUNT_ID" --arg at "$(date -u +%FT%TZ)" \
  '{ok:true, tunnel:$tunnel, tunnel_id:$tunnel_id, domain:$domain, origin:$origin, zone_id:$zone_id, account_id:$account_id, at:$at}'
