#!/usr/bin/env bash
# restore-tunnel.sh — self-heal the tunnel stack after a sandbox reset.
# The tunnel itself (config + DNS) lives in Cloudflare's cloud; if the
# token file under .secrets survived, everything reconnects automatically.
#   1. re-download the cloudflared binary if missing (GitHub, with a
#      pkg.cloudflare.com .deb fallback)
#   2. start provision-watcher (if not already running)
#   3. start the connector (graceful no-op if not provisioned yet)
set -u
DIR="/home/z/my-project/mini-services/tunnel"

# ── 1. binary ───────────────────────────────────────────────────────────
if [ ! -x "$DIR/bin/cloudflared" ]; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  ARCH=amd64 ;;
    aarch64) ARCH=arm64 ;;
  esac
  echo "cloudflared missing — downloading (linux-$ARCH) ..."
  mkdir -p "$DIR/bin"
  if curl -fL --retry 3 -o "$DIR/bin/cloudflared" \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH"; then
    chmod +x "$DIR/bin/cloudflared"
  else
    echo "GitHub download failed — falling back to pkg.cloudflare.com ..."
    rm -f "$DIR/bin/cloudflared"
    PKG_PATH="$(curl -fsSL "https://pkg.cloudflare.com/cloudflared/pool/bookworm/main/binary-$ARCH/Packages" \
      | sed -n 's/^Filename: //p' | head -n 1)"
    if [ -z "$PKG_PATH" ]; then
      echo "could not find a .deb in the package index" >&2
      exit 1
    fi
    curl -fL --retry 3 -o /tmp/cloudflared.deb "https://pkg.cloudflare.com/$PKG_PATH"
    rm -rf /tmp/cloudflared-extract
    dpkg -x /tmp/cloudflared.deb /tmp/cloudflared-extract
    for cand in /tmp/cloudflared-extract/usr/bin/cloudflared \
                /tmp/cloudflared-extract/usr/local/bin/cloudflared \
                /tmp/cloudflared-extract/bin/cloudflared; do
      if [ -f "$cand" ]; then cp "$cand" "$DIR/bin/cloudflared"; break; fi
    done
    chmod +x "$DIR/bin/cloudflared"
    rm -rf /tmp/cloudflared.deb /tmp/cloudflared-extract
  fi
fi
"$DIR/bin/cloudflared" --version

# ── 2. provision-watcher ────────────────────────────────────────────────
if ! pgrep -f "provision-watcher[.]sh" >/dev/null 2>&1; then
  nohup setsid bash "$DIR/provision-watcher.sh" >> "$DIR/provision-watcher.log" 2>&1 &
  sleep 1
  echo "provision-watcher started (pid $(pgrep -f 'provision-watcher[.]sh' | head -n 1))"
else
  echo "provision-watcher already running (pid $(pgrep -f 'provision-watcher[.]sh' | head -n 1))"
fi

# ── 3. connector (no-op if no tunnel token yet) ─────────────────────────
bash "$DIR/tunnel_ctl.sh" start
echo "restore complete"
