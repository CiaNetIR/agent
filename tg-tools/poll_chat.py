#!/usr/bin/env python3
"""Poll a Telegram chat for NEW INCOMING messages (blocks until one arrives).

Usage: poll_chat.py --chat @X --minutes 4 [--after-id N] [--last N]

Rules: never run concurrently with watcher/send (one client per session).
"""
import argparse
import asyncio
import os
import sys

from telethon import TelegramClient
from telethon.sessions import StringSession

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_common import (  # noqa: E402
    get_env, get_session_string, refuse_if_session_busy,
)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chat", required=True)
    ap.add_argument("--minutes", type=float, default=4.0)
    ap.add_argument("--after-id", type=int, default=None)
    ap.add_argument("--last", type=int, default=5,
                    help="show last N messages before waiting")
    args = ap.parse_args()

    refuse_if_session_busy("poll_chat.py")  # Part O: one session, one client

    session_string = get_session_string()
    if not session_string:
        print("ERROR: no session — run login_phone.py first", file=sys.stderr)
        sys.exit(2)
    client = TelegramClient(
        StringSession(session_string),
        int(get_env("TELEGRAM_API_ID")), get_env("TELEGRAM_API_HASH"),
        device_model="Z Tools", system_version="linux")
    await client.connect()
    if not await client.get_me():
        print("ERROR: session dead", file=sys.stderr)
        sys.exit(3)
    entity = await client.get_entity(args.chat)

    msgs = await client.get_messages(entity, limit=args.last)
    after = args.after_id
    if after is None and msgs:
        after = msgs[0].id
    print(f"POLLED chat={args.chat} baseline_id={after}")
    for m in sorted(msgs, key=lambda x: x.id)[-args.last:]:
        who = "OUT" if m.out else "IN "
        snippet = (m.message or "[media]").replace("\n", " ")[:100]
        print(f"HIST {who} id={m.id}: {snippet}")

    deadline = asyncio.get_event_loop().time() + args.minutes * 60
    found = False
    while not found and asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(6)
        fresh = await client.get_messages(entity, limit=8, min_id=after)
        for m in sorted(fresh, key=lambda x: x.id):
            after = max(after, m.id)
            if m.out:
                continue
            snippet = (m.message or "[media]").replace("\n", " ")
            print(f"NEW_INCOMING id={m.id} TEXT: {snippet}")
            found = True
    if not found:
        print("TIMEOUT_NO_INCOMING")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
