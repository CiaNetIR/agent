#!/usr/bin/env bash
# ns-inner.sh — runs INSIDE the unprivileged user namespace (fake root).
# All mounts are allowed for a userns-owned mount namespace:
#   rbind /dev /proc /sys from the host + private tmpfs for /dev/shm and /tmp.
set -u
R="/home/z/my-project/mini-services/vnc/rootfs"

mount --rbind /dev  "$R/dev"  2>/dev/null || echo '[ns] warn: /dev rbind failed'
mount --rbind /proc "$R/proc" 2>/dev/null || echo '[ns] warn: /proc rbind failed'
mount --rbind /sys  "$R/sys"  2>/dev/null || echo '[ns] warn: /sys rbind failed'
mount -t tmpfs -o size=1g,mode=1777   tmpfs "$R/dev/shm" 2>/dev/null || true
mount -t tmpfs -o size=256m,mode=1777 tmpfs "$R/tmp"     2>/dev/null || true

exec chroot "$R" /bin/sh /root/start-x.sh
