#!/usr/bin/env python3
"""send_full_backup.py — cloud copy of the FULL server backup tarball to
Saved Messages (OWNER_USER_ID = this account itself = chat 'me').

Usage:
    python3 send_full_backup.py [path/to/full-server-*.tar.gz]
    (no argument → newest tarball in ~/my-project/backups/)

⚠️ RUN ONLY WHILE THE WATCHER IS PAUSED (single session = single client):
     ~/tg-tools/watcher/watcher_ctl.sh pause   # wait for watcher to exit
     ~/tg-tools/send_full_backup.py
     ~/tg-tools/watcher/watcher_ctl.sh resume 15

Sends ONE message: the verified full-server tarball as attachment with a
Persian caption that ends with the bot footer (so the watcher's catchup
never mistakes it for an owner command). Also bumps state.last_sm_id past
the sent message id (double safety).
"""
import asyncio
import glob
import hashlib
import json
import os
import sys

sys.path.insert(0, "/home/z/tg-tools")
sys.path.insert(0, "/home/z/tg-tools/watcher")

import watcher  # noqa: E402  (constants: STATE_PATH, FOOTER)
from tg_common import (  # noqa: E402
    OWNER_USER_ID, atomic_write_json, get_env, get_session_string,
)
from telethon import TelegramClient  # noqa: E402
from telethon.sessions import StringSession  # noqa: E402

BACKUP_DIR = "/home/z/my-project/backups"


def newest_backup() -> str:
    candidates = sorted(glob.glob(f"{BACKUP_DIR}/full-server-*.tar.gz"))
    if not candidates:
        print(f"ERROR: no full-server-*.tar.gz in {BACKUP_DIR}")
        sys.exit(2)
    return candidates[-1]


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


async def main() -> int:
    if not get_session_string():
        print("ERROR: no session — login first")
        return 2
    backup_path = sys.argv[1] if len(sys.argv) > 1 else newest_backup()
    if not os.path.exists(backup_path):
        print(f"ERROR: backup not found: {backup_path}")
        return 2
    size_mb = os.path.getsize(backup_path) / (1024 * 1024)
    sha = sha256_of(backup_path)
    print(f"backup ready: {backup_path} ({size_mb:.1f} MB, sha256 {sha[:12]}…)")
    # verify against the .sha256 sidecar when present
    sidecar = backup_path + ".sha256"
    if os.path.exists(sidecar):
        want = open(sidecar).read().split()[0]
        if want != sha:
            print("ERROR: sha256 mismatch — aborting")
            return 2
        print("sha256 sidecar verified")

    from datetime import datetime
    tehran = datetime.now().astimezone(
        __import__("zoneinfo").ZoneInfo("Asia/Tehran")
    ).strftime("%-d %B %Y، %-H:%M")
    caption = (
        f"🛡 بکاپ کامل سرور — {size_mb:.0f} مگابایت — {tehran} تهران\n"
        f"مسیر: my-project/backups/{os.path.basename(backup_path)}\n"
        f"SHA256: {sha[:12]}…{sha[-8:]}"
        + watcher.FOOTER
    )

    # connect (watcher must be paused!)
    client = TelegramClient(
        StringSession(get_session_string()),
        int(get_env("TELEGRAM_API_ID")),
        get_env("TELEGRAM_API_HASH"),
        device_model="Z OwnerPkg", system_version="linux",
    )
    await client.connect()
    me = await client.get_me()
    if not me:
        print("ERROR: auth failed")
        return 3
    print(f"connected as @{me.username}")

    try:
        m = await client.send_file(
            OWNER_USER_ID, backup_path,
            caption=caption, supports_streaming=False)
        print("sent: full backup tarball", m.id)

        # double safety: bump last_sm_id past what we just sent
        state = {}
        if os.path.exists(watcher.STATE_PATH):
            try:
                with open(watcher.STATE_PATH, "r", encoding="utf-8") as f:
                    state = json.load(f)
            except (json.JSONDecodeError, OSError):
                state = {}
        state["last_sm_id"] = max(int(state.get("last_sm_id", 0)), m.id)
        atomic_write_json(watcher.STATE_PATH, state)
        print(f"state.last_sm_id -> {state['last_sm_id']}")
    finally:
        await client.disconnect()
    print("DONE — resume the watcher now: watcher_ctl.sh resume 15")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
