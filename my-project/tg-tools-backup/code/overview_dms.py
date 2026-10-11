#!/usr/bin/env python3
"""Quick overview: all user-DM dialogs, last message direction + time.
Purpose: find chats waiting for a reply (last=IN) since the watcher died.
"""
import asyncio
import sys
import time

sys.path.insert(0, "/home/z/tg-tools")
from telethon import TelegramClient  # noqa: E402
from telethon.sessions import StringSession  # noqa: E402
from telethon.tl.types import User  # noqa: E402
from tg_common import get_env, get_session_string  # noqa: E402

FOOTER_MARK = "هوش مصنوعی ارسال شده"


async def main():
    client = TelegramClient(
        StringSession(get_session_string()),
        int(get_env("TELEGRAM_API_ID")), get_env("TELEGRAM_API_HASH"),
        device_model="Z Tools", system_version="linux")
    await client.connect()
    now = time.time()
    n = 0
    rows = []
    async for d in client.iter_dialogs(limit=150):
        if not isinstance(d.entity, User):
            continue
        if getattr(d.entity, "bot", False):
            continue
        n += 1
        m = d.message
        if m is None:
            continue
        age_h = (now - m.date.timestamp()) / 3600
        if age_h > 20:
            continue
        direction = "OUT" if m.out else "IN"
        tag = ""
        if m.out:
            tag = " [bot]" if FOOTER_MARK in (m.message or "") else " [owner]"
        text = (m.message or "[media]").replace("\n", " ")[:45]
        rows.append((age_h, f"{n:3d}. {d.name[:22]:22s} "
                     f"@{str(d.entity.username or '-'):17s} "
                     f"last={direction}{tag} {age_h:5.1f}h ago | {text}"))
    for _, line in sorted(rows):
        print(line)
    print(f"total user DMs scanned: {n}")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
