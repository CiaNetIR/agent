#!/usr/bin/env bash
# tunnel-run.sh — run the cloudflared connector in the FOREGROUND (no
# daemonizing; supervisor.sh wraps this with restart + backoff).
set -euo pipefail

TOKEN_FILE="/home/z/my-project/.secrets/cloudflare/tunnel-token.txt"
BIN="/home/z/my-project/mini-services/tunnel/bin/cloudflared"

if [ ! -s "$TOKEN_FILE" ]; then
  echo "no tunnel token yet — waiting for provisioning (provision-watcher will handle it)" >&2
  exit 1
fi

# 2026-10-09 fix: cloudflared 2026.10.0 (urfave/cli) — --metrics and --loglevel
# are TUNNEL-level options (must come between `tunnel` and `run`); --token is a
# `run` subcommand option. Old order (`run ... --metrics ...`) died with
# "Incorrect Usage: flag provided but not defined: -metrics" + help dump, rc=0.
exec "$BIN" tunnel \
  --metrics 127.0.0.1:20241 \
  --loglevel info \
  run --token "$(cat "$TOKEN_FILE")"
