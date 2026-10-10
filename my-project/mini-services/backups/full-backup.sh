#!/usr/bin/env bash
# full-backup.sh — one self-contained tarball of the whole server (userland).
#
# Included: /home/z (code, secrets, tg session, mini-services incl. VNC web
#           assets, db, invoices, recovery zips, shell scripts, dotfiles)
#           + a SYSTEM-MANIFEST.txt snapshot of the environment.
# Excluded (rebuildable or huge): agent-repo git mirror (→ GitHub),
#           node_modules, .next, bun/npm caches, VNC Alpine rootfs
#           (rebuild via mini-services/vnc/setup.sh), upload/ (ossfs).
#
# Output: /home/z/my-project/backups/full-server-<YYYYMMDD-HHMM>.tar.gz[.sha256]
#         (kept OUT of the GitHub mirror — see run-backup.ts PROJECT_EXCLUDES)
set -euo pipefail
STAMP=$(TZ=Asia/Tehran date +%Y%m%d-%H%M)
OUT_DIR=/home/z/my-project/backups
OUT="$OUT_DIR/full-server-$STAMP.tar.gz"
mkdir -p "$OUT_DIR"

MANIFEST=/home/z/SYSTEM-MANIFEST.txt
{
  echo "# SYSTEM MANIFEST — $(date -u '+%Y-%m-%d %H:%M UTC')"
  echo "- kernel: $(uname -srmo)"
  echo "- os: $(sed -n 's/^PRETTY_NAME=//p' /etc/os-release 2>/dev/null | tr -d '"')"
  echo "--- disk ---"; df -h / | tail -1
  echo "--- versions ---"
  echo "bun $(bun -v 2>/dev/null) / node $(node -v 2>/dev/null) / $(python3 -V 2>&1) / $(git --version 2>/dev/null)"
  echo "--- listening ports ---"
  ss -tln 2>/dev/null | awk 'NR>1{print $4}' | sort -u | tr '\n' ' '; echo
  echo "--- crontab ---"; crontab -l 2>/dev/null || echo "(none)"
  echo "--- venv python packages ---"
  /home/z/.venv/bin/pip3 list --format=freeze 2>/dev/null | sed -n '1,60p' || true
  echo "--- vnc service ---"
  bash /home/z/my-project/mini-services/vnc/vnc_ctl.sh status 2>/dev/null || true
  echo "--- services summary ---"
  cd /home/z/my-project/mini-services
  for s in tunnel sshd backups monitor terminal agent vnc; do
    [ -f "$s/supervisor.pid" ] && echo "$s: supervisor $(cat $s/supervisor.pid 2>/dev/null)"
  done
} > "$MANIFEST" 2>&1 || true

tar -czf "$OUT" \
  --exclude='home/z/agent-repo' \
  --exclude='home/z/.venv' \
  --exclude='home/z/.npm-global' \
  --exclude='home/z/.agent-browser' \
  --exclude='home/z/.local/share/uv' \
  --exclude='home/z/.trash' \
  --exclude='home/z/.bun' \
  --exclude='home/z/.cache' \
  --exclude='home/z/.npm' \
  --exclude='home/z/my-project/node_modules' \
  --exclude='home/z/my-project/.next' \
  --exclude='home/z/my-project/.next-ci' \
  --exclude='home/z/my-project/tool-results' \
  --exclude='home/z/my-project/tmp' \
  --exclude='home/z/my-project/upload' \
  --exclude='home/z/my-project/backups' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.next-ci' \
  --exclude='home/z/my-project/mini-services/vnc/rootfs' \
  --exclude='home/z/my-project/mini-services/vnc/alpine.tar.gz' \
  --exclude='home/z/my-project/mini-services/vnc/web/core' \
  --exclude='home/z/my-project/mini-services/vnc/web/vendor' \
  --exclude='home/z/my-project/mini-services/vnc/web/app' \
  --exclude='home/z/my-project/mini-services/vnc/web/vnc.html' \
  --exclude='*.log' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='*.pid' \
  -C / home/z 2>/dev/null

rm -f "$MANIFEST"
SHA=$(sha256sum "$OUT" | awk '{print $1}')
printf "%s  %s\n" "$SHA" "$(basename "$OUT")" > "$OUT.sha256"
chmod 600 "$OUT" "$OUT.sha256"
# keep only the newest full tarball locally (old ones live in Telegram/GitHub history)
ls -1t "$OUT_DIR"/full-server-*.tar.gz 2>/dev/null | tail -n +2 | xargs -r rm -f
ls -1t "$OUT_DIR"/full-server-*.tar.gz.sha256 2>/dev/null | tail -n +2 | xargs -r rm -f
echo "OK $OUT ($(du -h "$OUT" | awk '{print $1}')) sha256=${SHA:0:12}…"
