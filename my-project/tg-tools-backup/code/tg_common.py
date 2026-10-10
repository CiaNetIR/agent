#!/usr/bin/env python3
"""Shared helpers for @VpnStarZ tooling.

Session/credentials live in /home/z/my-project/.secrets/tg.env (PERSISTENT
across sandbox resets — my-project is the only mounted volume that survives).
TELEGRAM_SESSION_STRING is appended there right after a successful login.

Rules (do not break):
- ONE client at a time on the session (one auth key = one live connection).
- Never delete the session. Never touch the production selfbot session.
"""
import os
import sys
import json
import time
import tempfile

SECRETS_ENV = "/home/z/my-project/.secrets/tg.env"
FALLBACK_ENV = "/home/z/tg-tools/.env"

OWNER_USER_ID = 6255258083  # @VpnStarZ (this account itself)


def load_env() -> dict:
    env = {}
    for path in (SECRETS_ENV, FALLBACK_ENV):
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    env.setdefault(k.strip(), v.strip())
    return env


def get_env(key: str, required: bool = True) -> str:
    env = load_env()
    val = env.get(key) or os.environ.get(key) or ""
    if not val and required:
        print(f"ERROR: missing {key} in {SECRETS_ENV}", file=sys.stderr)
        sys.exit(2)
    return val


def get_session_string() -> str:
    """Empty string = no session yet (login needed)."""
    return get_env("TELEGRAM_SESSION_STRING", required=False)


def save_session_string(session_string: str) -> None:
    """Persist the session string into the durable secrets file (atomic)."""
    lines = []
    if os.path.exists(SECRETS_ENV):
        with open(SECRETS_ENV, "r", encoding="utf-8") as f:
            lines = [l.rstrip("\n") for l in f.readlines()]
    lines = [l for l in lines if not l.startswith("TELEGRAM_SESSION_STRING=")]
    lines.append(f"TELEGRAM_SESSION_STRING={session_string}")
    tmp = tempfile.NamedTemporaryFile(
        "w", dir=os.path.dirname(SECRETS_ENV), delete=False, encoding="utf-8"
    )
    tmp.write("\n".join(lines) + "\n")
    tmp.close()
    os.replace(tmp.name, SECRETS_ENV)
    os.chmod(SECRETS_ENV, 0o600)
    # Also refresh the legacy backup copy
    try:
        os.makedirs(os.path.dirname(FALLBACK_ENV), exist_ok=True)
        with open(FALLBACK_ENV, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        os.chmod(FALLBACK_ENV, 0o600)
    except OSError:
        pass


def atomic_write_json(path: str, data: dict) -> None:
    tmp = tempfile.NamedTemporaryFile(
        "w", dir=os.path.dirname(path), delete=False, encoding="utf-8"
    )
    json.dump(data, tmp, ensure_ascii=False, indent=2)
    tmp.close()
    os.replace(tmp.name, path)


def jalali_now() -> str:
    """Current Tehran time string for logs."""
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()) + " UTC"
