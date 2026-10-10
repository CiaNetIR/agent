#!/usr/bin/env python3
"""Login flow for @VpnStarZ (fresh session, e.g. after sandbox reset).

Usage:
  login_phone.py send-code                    # step 1: request the login code
  login_phone.py complete --code 12345 [--password '2FA cloud password']
  login_phone.py status                       # show pending/active state

After `complete`, the StringSession is persisted to
/home/z/my-project/.secrets/tg.env (durable across sandbox resets).
"""
import argparse
import asyncio
import json
import os
import sys

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from telethon.sessions import StringSession

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_common import (  # noqa: E402
    SECRETS_ENV, get_env, get_session_string, save_session_string,
    refuse_if_session_busy,
)

PENDING = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pending.json")


def read_pending() -> dict:
    if not os.path.exists(PENDING):
        return {}
    with open(PENDING, "r", encoding="utf-8") as f:
        return json.load(f)


def write_pending(data: dict) -> None:
    tmp = PENDING + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, PENDING)
    os.chmod(PENDING, 0o600)


async def cmd_send_code(args):
    if get_session_string():
        print("NOTE: an active session already exists. Only request a new "
              "code if the old one is DEAD (e.g. reset). Continuing anyway.")
    api_id = int(get_env("TELEGRAM_API_ID"))
    api_hash = get_env("TELEGRAM_API_HASH")
    phone = args.phone or get_env("TELEGRAM_PHONE")
    session = StringSession()
    client = TelegramClient(session, api_id, api_hash,
                            device_model="Z Watcher", system_version="linux")
    await client.connect()
    sent = await client.send_code_request(phone)
    write_pending({
        "session_string": session.save(),
        "phone": phone,
        "phone_code_hash": sent.phone_code_hash,
    })
    me = await client.get_me()
    print("CODE_SENT")
    print(f"phone={phone}")
    print(f"phone_code_hash={sent.phone_code_hash}")
    print("Delivered to: Telegram app / SMS of the account owner.")
    print("Next: login_phone.py complete --code <5-digit>")
    await client.disconnect()


async def cmd_complete(args):
    # Part O: swapping the session under a LIVE watcher is forbidden —
    # stop the watcher first (send-code/status stay allowed: they use a
    # fresh auth key / no connection at all).
    refuse_if_session_busy("login_phone.py complete")
    pending = read_pending()
    if not pending:
        print("ERROR: no pending login. Run `login_phone.py send-code` first.",
              file=sys.stderr)
        sys.exit(2)
    client = TelegramClient(
        StringSession(pending["session_string"]),
        int(get_env("TELEGRAM_API_ID")), get_env("TELEGRAM_API_HASH"),
        device_model="Z Watcher", system_version="linux")
    await client.connect()
    try:
        await client.sign_in(
            phone=pending["phone"],
            code=args.code,
            phone_code_hash=pending["phone_code_hash"],
        )
    except SessionPasswordNeededError:
        if not args.password:
            print("2FA_NEEDED: cloud password required. Re-run with "
                  "--password '<cloud password>'", file=sys.stderr)
            await client.disconnect()
            sys.exit(3)
        await client.sign_in(password=args.password)
    me = await client.get_me()
    session_string = client.session.save()
    save_session_string(session_string)
    print("LOGIN_OK")
    print(f"user_id={me.id} name={me.first_name} username=@{me.username} "
          f"phone={me.phone}")
    print(f"session persisted to {SECRETS_ENV} (durable)")
    await client.disconnect()
    os.remove(PENDING)


async def cmd_status(args):
    pending = read_pending()
    print(f"pending_login: {'yes (code requested)' if pending else 'no'}")
    s = get_session_string()
    print(f"session_string: {'present' if s else 'MISSING — login required'}")


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sc = sub.add_parser("send-code")
    sc.add_argument("--phone", default=None)
    sub.add_parser("status")
    c = sub.add_parser("complete")
    c.add_argument("--code", required=True)
    c.add_argument("--password", default=None)
    args = p.parse_args()
    if args.cmd == "send-code":
        asyncio.run(cmd_send_code(args))
    elif args.cmd == "complete":
        asyncio.run(cmd_complete(args))
    elif args.cmd == "status":
        asyncio.run(cmd_status(args))


if __name__ == "__main__":
    main()
