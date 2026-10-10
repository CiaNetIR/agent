#!/usr/bin/env bash
# reset-panel-password.sh — generate a new web-panel password.
# Prints the new password; stores only its sha256 in .secrets/panel.env.
set -u
ENVF=/home/z/my-project/.secrets/panel.env
TERM_FLAG="$(grep -E '^PANEL_TERM=' "$ENVF" 2>/dev/null | tail -1 | cut -d= -f2 || echo 1)"
PW="$(python3 -c "import secrets,string; a=string.ascii_letters+string.digits; print(''.join(secrets.choice(a) for _ in range(20)))")"
SHA="$(printf '%s' "$PW" | sha256sum | cut -d' ' -f1)"
mkdir -p "$(dirname "$ENVF")"
printf 'PANEL_PASSWORD_SHA256=%s\nPANEL_TERM=%s\n' "$SHA" "${TERM_FLAG:-1}" > "$ENVF"
chmod 600 "$ENVF"
echo "panel password changed. NEW PASSWORD (save it now, shown once):"
echo ""
echo "    $PW"
echo ""
echo "web panel + terminal both use it. no restart needed — API routes and"
echo "the terminal service read the file per request/login."
