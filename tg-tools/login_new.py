#!/usr/bin/env python3
"""Simple NEW-account login flow for the panel wizard («اتصال ساده»).

Like login_phone.py, but for ADDING A NEW ACCOUNT from the web panel:
- never touches the main session in .secrets/tg.env
- prints machine-readable JSON (--json) for /api/panel/tg-login
- the finished StringSession is handed to the panel which stores it in the
  TgAccount row + instance env (~/tg-tools/instances/<id>/env)

Usage:
  login_new.py send-code --phone +98xxxxxxxxxx --json
  login_new.py complete --code 12345 [--password '2FA'] --json
  login_new.py cancel --json
  login_new.py status --json
"""
import argparse
import asyncio
import json
import os
import sys

from telethon import TelegramClient
from telethon.errors import (
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    PhoneCodeEmptyError,
    SessionPasswordNeededError,
    PasswordHashInvalidError,
    PhoneNumberInvalidError,
    FloodWaitError,
)
from telethon.sessions import StringSession

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tg_common import get_env  # noqa: E402

PENDING = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "pending-new.json")


def out(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


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


def clear_pending() -> None:
    try:
        os.remove(PENDING)
    except OSError:
        pass


def client_for(session_string: str) -> TelegramClient:
    return TelegramClient(
        StringSession(session_string), int(get_env("TELEGRAM_API_ID")),
        get_env("TELEGRAM_API_HASH"),
        device_model="Z Watcher", system_version="linux")


async def cmd_send_code(args):
    phone = (args.phone or "").strip()
    if not phone:
        out({"ok": False, "error": "شماره لازم است"})
        return
    session = StringSession()
    client = client_for(session.save())
    try:
        await client.connect()
        sent = await client.send_code_request(phone)
    except PhoneNumberInvalidError:
        out({"ok": False, "error": "شماره نامعتبر است"})
        return
    except FloodWaitError as e:
        out({"ok": False,
             "error": f"تلگرام فعلاً محدودش کرده؛ {e.seconds} ثانیه دیگر تلاش کن"})
        return
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "error": f"خطای تلگرام: {str(e)[:120]}"})
        return
    finally:
        try:
            await client.disconnect()
        except Exception:  # noqa: BLE001
            pass
    write_pending({"session_string": session.save(), "phone": phone,
                   "phone_code_hash": sent.phone_code_hash})
    out({"ok": True, "status": "code_sent", "phone": phone})


async def cmd_complete(args):
    pending = read_pending()
    if not pending:
        out({"ok": False, "status": "no_pending",
             "error": "اول شماره را بفرست تا کد برود"})
        return
    client = client_for(pending["session_string"])
    try:
        await client.connect()
        try:
            if args.password:
                # the code was already consumed by the first attempt (which
                # returned 2fa_needed) — the session holds the pending auth
                # state, so go straight to the password check instead of
                # re-sending the consumed code (some server responses would
                # otherwise yield a bogus "کد اشتباه است")
                await client.sign_in(password=args.password)
            else:
                await client.sign_in(
                    phone=pending["phone"], code=args.code,
                    phone_code_hash=pending["phone_code_hash"])
        except SessionPasswordNeededError:
            out({"ok": True, "status": "2fa_needed"})
            return
        except (PhoneCodeInvalidError, PhoneCodeEmptyError):
            out({"ok": False, "status": "bad_code",
                 "error": "کد اشتباه است"})
            return
        except PhoneCodeExpiredError:
            out({"ok": False, "status": "expired",
                 "error": "کد منقضی شده؛ دوباره کد بگیر"})
            return
        except PasswordHashInvalidError:
            out({"ok": False, "status": "bad_password",
                 "error": "رمز دو مرحله‌ای اشتباه است"})
            return
        except FloodWaitError as e:
            out({"ok": False,
                 "error": f"محدودیت تلگرام؛ {e.seconds} ثانیه دیگر تلاش کن"})
            return
        me = await client.get_me()
        session_string = client.session.save()
        clear_pending()
        out({"ok": True, "status": "logged_in",
             "user": {"id": me.id,
                      "first_name": me.first_name or "",
                      "username": me.username or "",
                      "phone": me.phone or pending["phone"]},
             "session": session_string})
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "error": f"خطای تلگرام: {str(e)[:120]}"})
    finally:
        try:
            await client.disconnect()
        except Exception:  # noqa: BLE001
            pass


async def cmd_status(_args):
    p = read_pending()
    out({"ok": True, "pending": bool(p),
         "phone": p.get("phone", "") if p else ""})


async def cmd_cancel(_args):
    clear_pending()
    out({"ok": True, "status": "cancelled"})


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sc = sub.add_parser("send-code")
    sc.add_argument("--phone", default=None)
    co = sub.add_parser("complete")
    co.add_argument("--code", required=True)
    co.add_argument("--password", default=None)
    sub.add_parser("status")
    sub.add_parser("cancel")
    args = p.parse_args()
    fn = {"send-code": cmd_send_code, "complete": cmd_complete,
          "status": cmd_status, "cancel": cmd_cancel}[args.cmd]
    asyncio.run(fn(args))


if __name__ == "__main__":
    main()
