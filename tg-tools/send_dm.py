#!/usr/bin/env python3
"""Send a DM (text and/or file) from @VpnStarZ.

Text comes from a UTF-8 file (no shell quoting problems). Never run
concurrently with watcher/poll (one client per session).

Usage:
  send_dm.py --chat <id|@username|me> --text-file msg.txt [--reply-to N]
  send_dm.py --chat me --file /tmp/backup.zip --text-file caption.txt
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
    ap.add_argument("--text-file", default=None)
    ap.add_argument("--file", default=None,
                    help="file to send (caption from --text-file)")
    ap.add_argument("--reply-to", type=int, default=None)
    args = ap.parse_args()

    refuse_if_session_busy("send_dm.py")  # Part O: one session, one client

    if not args.text_file and not args.file:
        print("ERROR: need --text-file and/or --file", file=sys.stderr)
        sys.exit(2)

    text = ""
    if args.text_file:
        with open(args.text_file, "r", encoding="utf-8") as f:
            text = f.read().strip()
    if args.file and not os.path.exists(args.file):
        print(f"ERROR: file not found: {args.file}", file=sys.stderr)
        sys.exit(2)

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
    if args.file:
        msg = await client.send_file(
            entity, args.file, caption=text or None,
            reply_to=args.reply_to, supports_streaming=False)
        print(f"FILE_SENT chat={args.chat} msg_id={msg.id} "
              f"file={os.path.basename(args.file)}")
    else:
        msg = await client.send_message(entity, text,
                                        reply_to=args.reply_to)
        print(f"SENT chat={args.chat} msg_id={msg.id} len={len(text)}")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
