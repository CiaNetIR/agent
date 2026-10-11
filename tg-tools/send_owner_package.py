#!/usr/bin/env python3
"""send_owner_package.py — ship the FULL owner package to Saved Messages.

⚠️ RUN ONLY WHILE THE WATCHER IS PAUSED (single session = single client):
     ~/tg-tools/watcher/watcher_ctl.sh pause   # wait for exit
     ~/tg-tools/send_owner_package.py
     ~/tg-tools/watcher/watcher_ctl.sh resume 15

Sends (all captions end with the bot footer so the watcher's catchup
never mistakes them for owner commands):
  1. Z-LLM-SETTINGS.txt   — readable snapshot of every LLM setting
  2. Z-OWNER-MANUAL.txt   — full Persian owner manual (shell access, DR…)
  3. z_backup_<stamp>.zip — full system backup (code+session+config+manual)
  4. short summary text   — includes the web-panel password
Also bumps state.last_sm_id past every sent message id (double safety).
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, "/home/z/tg-tools")
sys.path.insert(0, "/home/z/tg-tools/watcher")

import watcher  # noqa: E402  (constants, build_backup_zip, render_llm_settings_txt)
from tg_common import (  # noqa: E402
    OWNER_USER_ID, atomic_write_json, get_env, get_session_string,
)
from telethon import TelegramClient  # noqa: E402
from telethon.sessions import StringSession  # noqa: E402

PANEL_PASSWORD = os.environ.get("PANEL_PASSWORD", "")


async def main() -> int:
    if not get_session_string():
        print("ERROR: no session — login first")
        return 2

    # 1) build the package files
    zip_path = watcher.build_backup_zip()
    stamp = os.path.basename(zip_path).replace("z_backup_", "").replace(".zip", "")
    settings_path = "/tmp/Z-LLM-SETTINGS.txt"
    with open(settings_path, "w", encoding="utf-8") as f:
        f.write(watcher.render_llm_settings_txt())
    manual_path = "/tmp/Z-OWNER-MANUAL.txt"
    with open(manual_path, "w", encoding="utf-8") as f:
        with open(watcher.MANUAL_PATH, "r", encoding="utf-8") as src:
            f.write(src.read())

    size_kb = os.path.getsize(zip_path) // 1024
    print(f"package ready: zip {size_kb} KB, settings "
          f"{os.path.getsize(settings_path) // 1024} KB, "
          f"manual {os.path.getsize(manual_path) // 1024} KB")

    # 2) connect (watcher must be paused!)
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

    cap_settings = (
        "🧠 تنظیمات کامل هوش مصنوعی دستیار Z\n"
        f"زمان: {stamp} UTC\n"
        "شخصیت، مغز فرمان، قوانین دائمی، بلاک‌لیست، مدل و محدودیت‌ها — همه "
        "توی همین فایل به فارسی.\n\nهر وقت تنظیمات عوض شد، از Saved Messages "
        "بنویس «بکاپ» تا نسخه تازه برات بیاد." + watcher.FOOTER
    )
    cap_manual = (
        "📕 راهنمای کامل مالک — همه‌چیز توی همین فایل:\n"
        "• دسترسی شل به سرور (پنل وب + ترمینال مرورگر)\n"
        "• بازیابی کامل بعد از هر فاجعه‌ای (۳ سناریو)\n"
        "• فرمان‌های Saved Messages، بکاپ‌ها، امنیت\n\n"
        "این فایل رو یه جا ذخیره کن؛ نسخه تازه‌ترش همیشه داخل بکاپ‌ها هست."
        + watcher.FOOTER
    )
    cap_zip = (
        f"📦 بکاپ کامل دستیار Z — {stamp} UTC ({size_kb} KB)\n"
        "داخلش: کل کدها + سشن تلگرام + تنظیمات + راهنماها.\n"
        "⚠️ این فایل = کلید کامل اکانتته؛ هیچ‌وقت به کسی نده. "
        "راهنمای بازگردانی (RESTORE.md) داخل خود فایله." + watcher.FOOTER
    )

    sent_ids = []
    try:
        m1 = await client.send_file(
            OWNER_USER_ID, settings_path,
            caption=cap_settings, supports_streaming=False)
        sent_ids.append(m1.id)
        print("sent: settings", m1.id)
        await asyncio.sleep(3)

        m2 = await client.send_file(
            OWNER_USER_ID, manual_path,
            caption=cap_manual, supports_streaming=False)
        sent_ids.append(m2.id)
        print("sent: manual", m2.id)
        await asyncio.sleep(3)

        m3 = await client.send_file(
            OWNER_USER_ID, zip_path,
            caption=cap_zip, supports_streaming=False)
        sent_ids.append(m3.id)
        print("sent: backup zip", m3.id)
        await asyncio.sleep(3)

        summary = (
            "🎁 پکیج کامل مالک آماده‌ست:\n"
            "🧠 تنظیمات هوش مصنوعی (خوانا)\n"
            "📕 راهنمای کامل + دسترسی شل به سرور\n"
            "📦 بکاپ کامل سیستم\n\n"
            "🔑 رمز پنل وب: " + (PANEL_PASSWORD or "(همون رمزی که جدا برات "
                                                "فرستادم)") + "\n"
            "🖥 پنل: همون صفحه‌ای که پروژه رو می‌بینی، پنل Preview سمت راست "
            "رو باز کن → «پنل مدیریت Z» → این رمز → تب ترمینال = شل کامل "
            "سرور، بدون هیچ ایجنتی.\n\n"
            "⚠️ فایل zip کلید کل اکانتته — فقط همین‌جا نگهش دار."
            + watcher.FOOTER
        )
        m4 = await client.send_message(OWNER_USER_ID, summary)
        sent_ids.append(m4.id)
        print("sent: summary", m4.id)

        # double safety: bump last_sm_id past everything we just sent
        state = {}
        if os.path.exists(watcher.STATE_PATH):
            try:
                with open(watcher.STATE_PATH, "r", encoding="utf-8") as f:
                    state = json.load(f)
            except (json.JSONDecodeError, OSError):
                state = {}
        state["last_sm_id"] = max(int(state.get("last_sm_id", 0)),
                                  max(sent_ids))
        atomic_write_json(watcher.STATE_PATH, state)
        print(f"state.last_sm_id -> {state['last_sm_id']}")
    finally:
        await client.disconnect()
        for p in (zip_path, settings_path, manual_path):
            try:
                os.remove(p)
            except OSError:
                pass
    print("DONE — resume the watcher now: watcher_ctl.sh resume 15")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
