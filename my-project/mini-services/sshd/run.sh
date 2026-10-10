#!/usr/bin/env bash
# run.sh — userspace sshd in FOREGROUND (supervisor wraps this).
# Patched OpenSSH 10.0 (Debian trixie) extracted to /home/z/.opt/openssh —
# no root required. Listens ONLY on 127.0.0.1:2222 (tunnel-only exposure).
set -euo pipefail

PREFIX="/home/z/.opt/openssh"
export LD_LIBRARY_PATH="/home/z/.opt/openssh/extra-lib/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# ensure helper symlinks + runtime dirs exist (self-heal after /tmp wipe)
mkdir -p /home/z/s /tmp/sshd /home/z/.ssh
chmod 700 /home/z/.ssh
for b in sshd-session sshd-auth ssh-sk-helper; do
  [ -e "/home/z/s/$b" ] || ln -sf "$PREFIX/usr/lib/openssh/$b" "/home/z/s/$b"
done
chmod 755 /tmp/sshd

exec "$PREFIX/usr/sbin/sshd" -D -e -f "$PREFIX/etc/sshd_config"
