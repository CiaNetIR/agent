#!/usr/bin/env bash
# setup.sh — (RE)BUILD the noVNC desktop from scratch on a fresh server.
# Everything is unprivileged: Alpine rootfs + user-namespace chroot + XFCE.
# This is what makes the 1GB rootfs safely EXCLUDABLE from full backups.
set -euo pipefail
VNC_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$VNC_DIR"

echo "[setup] 1/5 — Alpine minirootfs"
if [ ! -x rootfs/bin/sh ]; then
  mkdir -p rootfs
  URL=$(curl -s https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/ \
        | grep -oE 'alpine-minirootfs-[0-9.]+-x86_64\.tar\.gz' | sort -V | tail -1)
  curl -sL -o alpine.tar.gz "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/$URL"
  tar -xzf alpine.tar.gz -C rootfs
  rm -f alpine.tar.gz
fi
cp /etc/resolv.conf rootfs/etc/resolv.conf
cp /etc/hosts rootfs/etc/hosts

echo "[setup] 2/5 — XFCE desktop stack inside the chroot"
unshare -Ur chroot rootfs /bin/sh -c \
  'apk add --no-cache xvfb x11vnc xfce4 xfce4-terminal mousepad dbus dbus-x11 \
     firefox-esr adwaita-icon-theme font-dejavu font-noto-naskh-arabic \
     font-misc-misc htop >/dev/null && echo "  packages OK ($(apk info | wc -l) installed)"'

echo "[setup] 3/5 — noVNC web client (bundled, gateway-safe)"
if [ ! -f web/rfb.bundle.js ]; then
  mkdir -p web
  curl -sL -o novnc.tar.gz https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.tar.gz
  tar -xzf novnc.tar.gz
  cp -r noVNC-1.5.0/core noVNC-1.5.0/vendor web/ 2>/dev/null || true
  cp noVNC-1.5.0/LICENSE.txt web/ 2>/dev/null || true
  rm -rf noVNC-1.5.0 novnc.tar.gz
fi
( cd web && bun build core/rfb.js --outfile rfb.bundle.js --format esm --target browser >/dev/null )
rm -rf web/core web/vendor
[ -f web/index.html ] || echo "MISSING web/index.html — restore from backup!" >&2

echo "[setup] 4/5 — VNC password"
if [ ! -f rootfs/root/vnc.pass ]; then
  PW=$(python3 -c "import secrets;print(secrets.token_urlsafe(9))")
  printf "VNC_PASSWORD=%s\n" "$PW" > /home/z/my-project/.secrets/vnc.env
  chmod 600 /home/z/my-project/.secrets/vnc.env
  unshare -Ur chroot rootfs x11vnc -storepasswd "$PW" /root/vnc.pass
  echo "  new password written to .secrets/vnc.env"
else
  echo "  kept existing password (rootfs/root/vnc.pass)"
fi

echo "[setup] 5/5 — done. start with: bash vnc_ctl.sh start"
