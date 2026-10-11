#!/usr/bin/env python3
"""Read the tail of specific chats (read-only, run while watcher paused)."""
import asyncio
import sys
import time

sys.path.insert(0, "/home/z/tg-tools")
from telethon import TelegramClient  # noqa: E402
from telethon.sessions import StringSession  # noqa: E402
from tg_common import (  # noqa: E402
    get_env, get_session_string, refuse_if_session_busy,
)

OLD_FOOTER_MARK = "هوش مصنوعی ارسال شده"


async def show(client, target, label):
    entity = await client.get_entity(target)
    msgs = await client.get_messages(entity, limit=8)
    print(f"\n=== {label} ({target}) ===")
    for m in sorted(msgs, key=lambda x: x.id)[-8:]:
        ts = m.date.astimezone(timezone.utc).strftime("%H:%M") \
            if m.date else "?"
        who = "OUT" if m.out else "IN "
        tag = ""
        if m.out and OLD_FOOTER_MARK in (m.message or ""):
            tag = " [bot]"
        elif m.out:
            tag = " [owner/bare]"
        print(f"  {ts} {who}{tag}: {(m.message or '[media]')[:90]}")


async def main():
    refuse_if_session_busy("peek.py")  # Part O: one session, one client
    client = TelegramClient(
        StringSession(get_session_string()),
        int(get_env("TELEGRAM_API_ID")), get_env("TELEGRAM_API_HASH"),
        device_model="Z Tools", system_version="linux")
    await client.connect()
    for target, label in [("M2nuX", "مهران"),
                          (7048082345, "قیمت-پرسیدن"),
                          (8633966567, "ایموجی‌فرست"),
                          (8709025943, "پشتیبانی-پرسیدن")]:
        try:
            await show(client, target, label)
        except Exception as e:  # noqa: BLE001
            print(f"=== {label}: FAIL {str(e)[:60]}")
    await client.disconnect()


if __name__ == "__main__":
    from datetime import timezone
    asyncio.run(main())
