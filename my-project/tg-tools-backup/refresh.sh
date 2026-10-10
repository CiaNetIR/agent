#!/usr/bin/env bash
# refresh.sh — refresh the durable code mirror in this directory from ~/tg-tools.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TG=/home/z/tg-tools

mkdir -p "$HERE/code/watcher"
rsync -a --delete \
  --exclude '__pycache__' --exclude '*.pyc' \
  --exclude 'watcher/wlog.jsonl*' --exclude 'watcher/wstdout.log' \
  --exclude 'watcher/supervisor.pid' --exclude 'watcher/watcher.lock' \
  --exclude 'watcher/PAUSE' --exclude 'watcher/BACKUP_NOW' \
  --exclude 'watcher/catchup.txt' --exclude 'watcher/.llm_*' \
  --exclude '.env' --exclude 'msg_ack.txt' \
  "$TG/" "$HERE/code/" 2>/dev/null || {
    # no rsync? plain cp fallback
    (cd "$TG" && find . -type f \
      ! -path '*__pycache__*' ! -name '*.pyc' \
      ! -name 'wlog.jsonl*' ! -name 'wstdout.log' \
      ! -name 'supervisor.pid' ! -name 'watcher.lock' \
      ! -name 'PAUSE' ! -name 'BACKUP_NOW' ! -name 'catchup.txt' \
      ! -name '.env' ! -name 'msg_ack.txt' \
      -exec cp --parents {} "$HERE/code/" \;)
  }
echo "mirror refreshed:"
find "$HERE/code" -type f | sed "s|$HERE/||" | sort
