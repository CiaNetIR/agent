#!/usr/bin/env python3
"""Inspect recent DMs of @VpnStarZ: who wrote, when, what's unanswered.

Usage: inspect_dms.py [--hours 14] [--limit 40] [--chat <id|@username>]

For every recent DM shows the last few messages (direction, time, snippet)
so it is easy to see when replies stopped and which chats are waiting.
Read-only; safe to run while watcher is paused.
"""
import argparse
import asyncio
import os
import sys
import time
from datetime import datetime, timezone

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import User

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_common import get_env, get_session_string  # noqa: E402

FOOTER_MARK = "هوش مصنوعی ارسال شده"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=14.0)
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--chat", default=None,
                    help="inspect a single chat (id or @username)")
    args = ap.parse_args()

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

    since = time.time() - args.hours * 3600
    targets = []
    if args.chat:
        entity = await client.get_entity(args.chat)
        targets = [entity]
    else:
        dialogs = await client.get_dialogs(limit=args.limit)
        targets = [d.entity for d in dialogs
                   if isinstance(d.entity, User)
                   and not getattr(d.entity, "bot", False)]

    print(f"=== DMs with activity in last {args.hours}h ===")
    for u in targets:
        try:
            msgs = await client.get_messages(u.id, limit=6)
        except Exception:  # noqa: BLE001
            continue
        recent = [m for m in msgs if m.date and m.date.timestamp() > since]
        if not recent:
            continue
        name = " ".join(filter(None, [u.first_name, u.last_name])) or "?"
        uname = f"@{u.username}" if u.username else "no-username"
        print(f"\n--- {name} ({uname}, id {u.id}) ---")
        for m in sorted(recent, key=lambda x: x.id):
            ts = m.date.astimezone(timezone.utc).strftime("%m-%d %H:%M")
            who = "OUT" if m.out else "IN "
            tag = ""
            if m.out and FOOTER_MARK in (m.message or ""):
                tag = " [bot]"
            elif m.out:
                tag = " [owner-personal]"
            snippet = (m.message or "[media]").replace("\n", " ")[:90]
            print(f"  {ts} {who}{tag}: {snippet}")
        last = max(recent, key=lambda x: x.id)
        if not last.out:
            wait = (time.time() - last.date.timestamp()) / 60
            print(f"  >>> UNANSWERED ({wait:.0f} min waiting)")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
