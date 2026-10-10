#!/usr/bin/env bash
# run-session.sh — host-side launcher for the isolated Alpine desktop.
#
# Everything is UNPRIVILEGED: a user namespace maps uid 1001 → root inside,
# which is enough to mount/rbind inside a private mount namespace and to
# chroot into our own Alpine rootfs. No real root, no setuid, no host pkgs.
#
# Run via setsid (supervisor.sh does this) so the whole tree shares one
# process group — stop() kills the group and the tree dies together.
set -u
VNC_DIR="/home/z/my-project/mini-services/vnc"

if [ "$(id -u)" = "0" ]; then
  echo "[run-session] refusing to run as real root (never needed)" >&2
  exit 2
fi

exec unshare -Ur -m -- bash "$VNC_DIR/ns-inner.sh"
