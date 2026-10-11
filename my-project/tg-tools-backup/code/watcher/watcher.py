#!/usr/bin/env python3
"""@VpnStarZ — always-on AI auto-responder (v6).

v6 (owner request, 2026-10-07 evening — "backup + owner tutorial + shell access"):
- Backup zip now carries docs/Z-OWNER-MANUAL.md (full Persian owner manual)
  and Z-LLM-SETTINGS.txt (readable snapshot of the LLM persona/settings).
- llm_settings_dict()/render_llm_settings_txt(): single source of truth used
  by the web panel (/api/panel/llm-settings) and the backup zip.
- BACKUP_NOW trigger file: the owner panel's "بکاپ فوری" button drops the
  file; the watchdog loop picks it up within 10 s and ships a fresh zip to
  Saved Messages — no second Telegram client ever needed.

v5: glm-4-plus + thinking (strongest config), permanent window (never off
by any command), hardened JSON extraction, 3x LLM retries.

v4: HUMAN persona, multi-action Saved-Messages command channel
(blacklist/send/status/remember/forget/backup/broadcast with بله-confirm),
auto-backup on config change (1/h throttle).

Carried from v3: mandatory code-appended footer on EVERY bot message (also
the bot-vs-owner discriminator), service-account skip, 2FA danger refusal,
owner-active skip, rate limits, flood handling, LLM in executor, catchup
(incl. missed Saved-Messages commands via last_sm_id), PAUSE watchdog,
DMs-only, no bots.

Durable files:
  /home/z/my-project/.secrets/tg.env               session + api creds
  /home/z/my-project/.secrets/watcher-config.json  blacklist + instructions
  /home/z/my-project/tg-tools-backup/              code mirror + owner manual
"""
import argparse
import asyncio
import json
import os
import random
import re
import subprocess
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from telethon import TelegramClient, events
from telethon.errors import FloodWaitError
from telethon.sessions import StringSession
from telethon.tl.types import User

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tg_common import (  # noqa: E402
    OWNER_USER_ID, atomic_write_json, get_env, get_session_string,
)

HERE = os.path.dirname(os.path.abspath(__file__))
TG_TOOLS = os.path.dirname(HERE)
SECRETS_DIR = "/home/z/my-project/.secrets"
STATE_PATH = os.path.join(HERE, "state.json")
LOG_PATH = os.path.join(HERE, "wlog.jsonl")
PAUSE_PATH = os.path.join(HERE, "PAUSE")
LIVE_LOCK = os.path.join(HERE, "watcher.lock")
CONFIG_PATH = os.path.join(SECRETS_DIR, "watcher-config.json")
MANUAL_PATH = "/home/z/my-project/tg-tools-backup/Z-OWNER-MANUAL.md"
BACKUP_TRIGGER = os.path.join(HERE, "BACKUP_NOW")

Z_AI = "/usr/local/bin/z-ai"
# Footer wording per owner's Saved-Messages instruction (2026-10-07 16:10 UTC):
# «به جای ... باید بگویید: من یک دستیار هوش مصنوعی هستم. پشتیبانی آفلاین است.»
FOOTER = "\n\nمن یک دستیار هوش مصنوعی هستم. پشتیبانی آفلاین است."
# older bot messages (sent before 2026-10-07 16:30 UTC) end with this:
_OLD_FOOTER = ("\n\n🤖 این پاسخ توسط هوش مصنوعی ارسال شده — "
               "پشتیبانی آنلاین انسانی فعلاً در دسترس نیست.")
FOOTER_MARKS = [FOOTER.strip(), _OLD_FOOTER.strip()]

SYSTEM_PROMPT = """تو همون ادمینِ دستیار فروشگاه «VPN | STAR» هستی که توی دایرکت پیج جواب آدم‌ها رو می‌دی. اسم تو Z هست ولی خودتو معرفی نمی‌کنی مگه مستقیم بپرسن.

مهم‌ترین قانون: دقیقاً مثل یه آدم واقعی تایپ کن، انگار داری با یه مشتری توی دایرکت گپ می‌زنی:
- کاملاً خودمونی و خودی بنویس، همون سبکی که بچه‌های تلگرام فارسی چت می‌کنن
- نیم‌فاصله اصلاً نذار: «میخوام، میتونی، بشه، بریم» (نه می‌خواهم)
- جملات کوتاه و داغونی، گاهی بدون نقطه و کاما، گاهی تکی کلمه‌ای
- ایموجی به‌جا و کم: 😂 ❤️ 🙏 ✨ 🔥 — نه تو هر پیام، نه چندتا پشت هم
- لحن طرف رو کپی کن: محترم اومد محترمانه جواب بده، شوخ اومد شوخ، بی‌ادب شد محکم ولی باوقار
- گاهی عامیانه: داداش، عزیز، رفیق، حله، اوکیه، سوییچه
- هیچ‌وقت لیست و سرخط و جمع‌بندی آخر پیام ننویس، آدم‌ها اینجوری دایرکت نمی‌دن
- طول جواب هم‌قد پیام طرف: معمولاً یه خط تا سه خط. فقط اگه توضیح واقعاً لازمه طولانی‌تر شو
- سلام و احوالپرسی رو کوتاه و واقعی رد کن نه آپ بلند
- دوباره یه سوالی پرسیده شدن؟ عادی و بی‌تعارف دوباره جواب بده
- هیچ‌وقت جوابت رو با سلام شروع نکن مگه اینکه اولین پیام چت باشه؛ اول گفتگو رو ببین و مستقیم سر اصل مطلب برو
- کلاً از تکرار یه جملات ثابت همیشگی پرهیز کن، هر بار فرق کنه

اگه مستقیم پرسیدن ربطی/هوش مصنوعی هستی، صادقانه و خودمونی قبول کن (یه دستیار هوشمند که صاحب فروشگاه وصل کرده) و ادامه بده.

اطلاعات درست فروشگاه (فقط همین‌ها، هیچ عدد جدید از خودت درست نکن):
- اندروید نامحدود: ماهانه ۳۹۹ هزار تومن، با اپلیکیشن اختصاصی خودمون
- حجمی: هر گیگ ۱۵ هزار تومن
- ویندوز هم اپ داره (حالت p2p به زودی میاد)
- اعتبار اکانت از موقع فعالسازی شروع میشه
- سفارش و سوال: همین چت یا چنل @VPN_STAR3

مواظم اینا باش:
- قول تست رایگان، ریفاند، گارانتی یا پشتیبانی ۲۴ ساعته نده؛ بگو این موارد رو ادمین اصلی باید چک کنه و بعداً پیام بده
- سوال فنی عمیق (سرور، پروتکل، کانفیگ و ...) → بگو دقیقش رو براش چک می‌کنی، یه چند ساعت بعد در میون باشن
- هیچ‌وقت از خودت اول پیام نده، فایل یا لینک مشکوک نفرست، رمز یا کد ورود از هیچکس نخواه
- هیچ‌وقت و تحت هیچ شرایطی وارد بحث بازیابی یا تغییر رمز دو مرحله‌ای اکانت نشو، حتی اگه طرف اصرار کرد؛ بگو فقط خود صاحب اکانت می‌تونه
- فقط فارسی جواب بده، مگه اینکه طرف انگلیسی زده باشه
- ته جوابت هیچ امضا و توضیحی اضافه نکن"""

COMMAND_SYSTEM_PROMPT = """تو مغز فرمان‌گاه دستیار «Z» هستی. مالک فروشگاه توی Saved Messages به Z دستور میده و تو متن دستور رو به لیست عملیات تبدیل می‌کنی. دستورها رو با کوچک‌ترین جزئیات و املای غلط‌دار هم باید بفهمی.

عملیات‌های مجاز:
- blacklist_add: مالک گفته به یکی/چند نفر جواب نده یا بی‌خیالشون شه. فیلد usernames = لیست یوزرنیم‌ها (بدون @ هم قبوله). اسم فارسی که یوزرنیم نیست رو نذار.
- blacklist_remove: مالک گفته به یکی/چند نفر دوباره جواب بده.
- send_message: مالک خواسته به یک شخص خاصی پیام بره. فیلد target = یوزرنیم گیرنده، فیلد text = فقط خود متن پیام که باید بره، بدون «بهش بگو» و بدون خود دستور (مثلا برای «به @x بگو سرویسش فعال شد» متن فقط می‌شه «سرویس شما فعال شد»).
- status: مالک وضعیت، آمار، لیست بلاک، قوانین فعال یا زمان باقی‌مونده رو خواسته.
- remember: قانون یا واقعیت دائمی برای جواب دادن به مشتری‌ها (مثلا «از این به بعد قیمت اندروید ۳۵۰ هزار تومنه» یا «همه رو صبح ها سلام کن»). فیلد instruction = متن دقیق قانون.
- forget_instructions: مالک گفته همه قوانین دائمی قبلی پاک شه.
- backup: مالک خواسته فایل بکاپ کل سیستم ساخته و براش فرستاده شه (بکاپ بگیر / نسخه پشتیبان بفرست).
- broadcast: مالک خواسته یک پیام به همه مشتری‌های اخیر بره (به همه بگو ... / به همه خبر بده که ...). فیلد text = فقط خود متن پیام که باید برای مشتری‌ها بره، بدون «به همه بگو» و بدون خود دستور (مثلا برای «به همه بگو تخفیف داریم» متن فقط می‌شه «تخفیف داریم»). Z خودش قبل ارسال تایید می‌گیره، تو کاری نکن.
- chat: هر چیز دیگه — گپ، سوال، یا درخواستی که تو لیست نیست. اگه درخواستی از توان Z خارجه (مثل بلاک واقعی تلگرام، پاک کردن پیام‌ها، تغییر رمز اکانت و ...) صادقانه جواب بده این کار از دستت برنمیاد و چی می‌تونی. فیلد reply = جواب خودت به مالک، حتماً خودمونی و آدمیزادی و کوتاه (مثل سبک گپ با یه رفیق)، نه رسمی و نه «متاسفانه نمی‌توانم».

ممکنه مالک چند تا کار رو تو یه پیام بگه؛ همه رو به ترتیب تو لیست actions بذار.
قانون ویژه: اگه مالک گفت دستیار خاموش شه، ری‌استارت شه، تعطیل شه یا قطع شه — این یه درخواست غیرممکنه؛ با action=chat جواب بده که طبق دستور قبلی خود مالک، Z هیچ‌وقت با هیچ دستوری خاموش نمی‌شه و همیشه فعاله.
خروجی فقط و فقط این JSON هست، بدون هیچ متن اضافه:
{"actions":[{"action":"...","usernames":[],"target":"","text":"","instruction":"","reply":""}]}"""

FALLBACK_TEXT = ("یه لحظه صبر کن الان یه اشکالی پیش اومده، چند دقیقه بعد دوباره " "پیام بده حله؟ 🙏")
MEDIA_PLACEHOLDER = "[پیام با عکس/فایل — متن نداشت]"
MEDIA_REPLY = ("الان نمی‌تونم عکس یا فایلو ببینم 😅 اگه میشه همون متنش رو " "بنویس تا دقیق بگم")

# 2FA safety net — refuse before parsing
DANGER_RE = re.compile(r"tfago:|abok:|بازنشانی|باز ?نشانی|ریست ?دو ?مرحله", re.I)

# Telegram service/system accounts — NEVER reply
SERVICE_USER_IDS = {777000}
SERVICE_USERNAMES = {"telegram"}

# bare confirmations that trigger a pending broadcast
CONFIRM_WORDS = {"بله", "بلـه", "اره", "آره", "اوکی", "برو", "بفرست",
                 "ارسال کن", "تایید", "باشه بفرست"}
CANCEL_WORDS = {"نه", "نچ", "لغو", "بی‌خیال", "بیخیال", "کنسل"}

BACKUP_FILES = [
    ("tg_common.py", os.path.join(TG_TOOLS, "tg_common.py")),
    ("login_phone.py", os.path.join(TG_TOOLS, "login_phone.py")),
    ("poll_chat.py", os.path.join(TG_TOOLS, "poll_chat.py")),
    ("send_dm.py", os.path.join(TG_TOOLS, "send_dm.py")),
    ("inspect_dms.py", os.path.join(TG_TOOLS, "inspect_dms.py")),
    ("overview_dms.py", os.path.join(TG_TOOLS, "overview_dms.py")),
    ("watcher/watcher.py", os.path.join(HERE, "watcher.py")),
    ("watcher/supervisor.sh", os.path.join(HERE, "supervisor.sh")),
    ("watcher/watcher_ctl.sh", os.path.join(HERE, "watcher_ctl.sh")),
    ("watcher/README.md", os.path.join(HERE, "README.md")),
    ("watcher/state.json", STATE_PATH),
    ("secrets/tg.env", os.path.join(SECRETS_DIR, "tg.env")),
    ("secrets/watcher-config.json", CONFIG_PATH),
    ("docs/Z-OWNER-MANUAL.md", MANUAL_PATH),
]

DEBOUNCE_S = 10
OWNER_ACTIVE_S = 15 * 60
PER_CHAT_H = 12
GLOBAL_H = 30
CATCHUP_DEFAULT_MIN = 15
LLM_TIMEOUT_S = 90
LLM_RETRIES = 3          # strongest-resilience: 3 tries before fallback
LLM_THINKING = True      # glm-4-plus thinking mode (strongest config)
LOG_ROTATE_BYTES = 5 * 1024 * 1024
AUTOBACKUP_MIN_GAP = 3600
BROADCAST_MAX = 50
BROADCAST_CONFIRM_S = 10 * 60
PERMANENT_WINDOW_END = 4102444800  # 2100-01-01 — "never off" per owner


class WLog:
    def __init__(self, path: str):
        self.path = path

    def log(self, event: str, **kw):
        rec = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "event": event}
        rec.update(kw)
        try:
            if os.path.exists(self.path) and \
                    os.path.getsize(self.path) > LOG_ROTATE_BYTES:
                os.replace(self.path, self.path + ".1")
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except OSError:
            pass
        snippet = {k: (str(v)[:100] if isinstance(v, str) else v)
                   for k, v in kw.items()}
        print(f"[{rec['ts']}] {event} {snippet}", flush=True)


WLOG = WLog(LOG_PATH)
LLM_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="llm")


def load_state() -> dict:
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    now = int(time.time())
    return {"window_start": now, "window_end": PERMANENT_WINDOW_END,
            "replies_total": 0, "started_count": 0, "last_sm_id": 0,
            "mode": "permanent"}


def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"blacklist": [], "instructions": [],
            "saved_messages_commands": True}


def _z_ai_call(prompt: str, system: str) -> str:
    """Blocking z-ai chat CLI call — always inside LLM_POOL executor.
    Uses glm-4-plus (the strongest model this endpoint serves) with
    thinking mode enabled (LLM_THINKING) — strongest available config."""
    out_file = os.path.join(HERE, f".llm_{os.getpid()}.json")
    cmd = [Z_AI, "chat", "-p", prompt, "-s", system, "-o", out_file]
    if LLM_THINKING:
        cmd.append("-t")  # flag must come AFTER the chat subcommand
    last_err = ""
    for attempt in range(1, LLM_RETRIES + 1):
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True,
                                  timeout=LLM_TIMEOUT_S)
            if proc.returncode != 0:
                raise RuntimeError("z-ai exit %d: %s"
                                   % (proc.returncode, proc.stderr[-200:]))
            with open(out_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            text = (data.get("choices") or [{}])[0] \
                .get("message", {}).get("content", "").strip()
            if not text:
                raise RuntimeError("empty LLM content")
            return text
        except (subprocess.TimeoutExpired, RuntimeError, json.JSONDecodeError,
                OSError) as e:
            last_err = str(e)
            WLOG.log("llm_fail", attempt=attempt, err=last_err[:120])
            time.sleep(2)
    raise RuntimeError(last_err or "llm failed")


async def llm_reply(prompt: str, system: str = None) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        LLM_POOL, _z_ai_call, prompt, system or SYSTEM_PROMPT)


def _extract_json(text: str) -> dict:
    """Robustly pull the first valid JSON object out of LLM output
    (handles ```json fences, stray prose, nested braces, strings)."""
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    start = text.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    cand = text[start:i + 1]
                    try:
                        return json.loads(cand)
                    except json.JSONDecodeError:
                        break  # try next '{' start
        start = text.find("{", start + 1)
    raise RuntimeError("no valid json in command output")


async def llm_command(command_text: str) -> list:
    """Parse owner command -> list of action dicts."""
    loop = asyncio.get_running_loop()

    def call():
        js = _extract_json(_z_ai_call(
            "دستور مالک:\n" + command_text, COMMAND_SYSTEM_PROMPT))
        acts = js.get("actions") or [js]
        return [a for a in acts if isinstance(a, dict) and a.get("action")]
    return await loop.run_in_executor(LLM_POOL, call)


def is_service_user(user) -> bool:
    uid = getattr(user, "id", None)
    uname = (getattr(user, "username", None) or "").lower()
    return uid in SERVICE_USER_IDS or uname in SERVICE_USERNAMES


def normalize_username(u: str) -> str:
    return u.strip().lstrip("@").lower()


def llm_settings_dict() -> dict:
    """Single source of truth for the LLM settings snapshot.

    Used by the web panel (/api/panel/llm-settings) and by
    render_llm_settings_txt() inside every backup zip."""
    cfg = load_config()
    return {
        "persona": SYSTEM_PROMPT,
        "command_prompt": COMMAND_SYSTEM_PROMPT,
        "model": "glm-4-plus",
        "thinking": LLM_THINKING,
        "retries": LLM_RETRIES,
        "rate_limits": {"per_chat_hour": PER_CHAT_H,
                        "global_hour": GLOBAL_H,
                        "debounce_s": DEBOUNCE_S},
        "footer": FOOTER.strip(),
        "instructions": cfg.get("instructions") or [],
        "blacklist": [{"username": b.get("username", ""),
                       "name": b.get("name", "")}
                      for b in cfg.get("blacklist") or []],
        "prices": {"android_monthly": "۳۹۹ هزار تومن",
                   "per_gb": "۱۵ هزار تومن"},
    }


def render_llm_settings_txt() -> str:
    """Human-readable snapshot of every LLM setting (for Telegram)."""
    d = llm_settings_dict()
    rl = d["rate_limits"]
    lines = [
        "╔══════════════════════════════════════════════════╗",
        "║   تنظیمات هوش مصنوعی دستیار Z — VPN | STAR        ║",
        "╚══════════════════════════════════════════════════╝",
        f"تاریخ تولید: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "── مغز و مدل " + "─" * 33,
        f"مدل: {d['model']}",
        f"حالت تفکر: {'فعال' if d['thinking'] else 'غیرفعال'}",
        f"تلاش مجدد در خطا: {d['retries']} بار",
        f"محدودیت هر چت: {rl['per_chat_hour']} جواب در ساعت",
        f"محدودیت کلی: {rl['global_hour']} جواب در ساعت",
        f"تاخیر گروه‌بندی پیام‌ها: {rl['debounce_s']} ثانیه",
        "",
        "── فوتر اجباری هر پیام بات " + "─" * 23,
        d["footer"],
        "",
        "── شخصیت دستیار (SYSTEM_PROMPT) " + "─" * 17,
        d["persona"],
        "",
        "── مغز فرمان‌های Saved Messages " + "─" * 19,
        d["command_prompt"],
        "",
        f"── قوانین دائمی مالک ({len(d['instructions'])} مورد) " + "─" * 17,
    ]
    for i, ins in enumerate(d["instructions"], 1):
        lines.append(f"{i}. {ins}")
    if not d["instructions"]:
        lines.append("(هیچ قانون دائمی ثبت نشده)")
    lines += ["", f"── بلاک‌لیست ({len(d['blacklist'])} نفر) " + "─" * 25]
    for b in d["blacklist"]:
        nm = f" — {b['name'].strip()}" if b.get("name") else ""
        lines.append(f"- @{b['username']}{nm}")
    if not d["blacklist"]:
        lines.append("(خالی)")
    lines += [
        "",
        "── قیمت‌های رسمی " + "─" * 32,
        f"اندروید نامحدود: {d['prices']['android_monthly']} در ماه",
        f"حجمی: {d['prices']['per_gb']} هر گیگ",
        "",
        "منبع اصلی این تنظیمات: ~/tg-tools/watcher/watcher.py و",
        "~/my-project/.secrets/watcher-config.json — هر تغییری توی اینا،",
        "با فرمان «بکاپ» توی Saved Messages نسخه تازه همین فایل برات میاد.",
    ]
    return "\n".join(lines)


def build_backup_zip() -> str:
    """Full self-backup zip (session + config + code + state + runbook)."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    path = f"/tmp/z_backup_{stamp}.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for arcname, src in BACKUP_FILES:
            if os.path.exists(src):
                z.write(src, arcname)
        z.writestr("RESTORE.md", RESTORE_GUIDE)
        z.writestr("Z-LLM-SETTINGS.txt", render_llm_settings_txt())
    return path


RESTORE_GUIDE = """# بازگردانی دستیار Z از فایل بکاپ

۱. این فایل رو روی یه لینوکس با پایتون ۳.۱۰+ باز کن:
   unzip z_backup_<date>.zip -d z-restore && cd z-restore
۲. نصب وابستگی:  uv pip install --python $(which python3) telethon
۳. سشن و تنظیمات رو بذار تو مسیر ماندگار:
   mkdir -p <project>/.secrets
   cp secrets/tg.env secrets/watcher-config.json <project>/.secrets/
   (tg.env شامل TELEGRAM_SESSION_STRING است — همین کافیه که بدون کد جدید وصل شی)
۴. ابزارها:  mkdir -p ~/tg-tools/watcher
   cp tg_common.py login_phone.py poll_chat.py send_dm.py inspect_dms.py overview_dms.py ~/tg-tools/
   cp watcher/* ~/tg-tools/watcher/ && chmod +x ~/tg-tools/watcher/*.sh ~/tg-tools/*.py
۵. تست سشن:  python3 ~/tg-tools/login_phone.py status
۶. روشن کردن: ~/tg-tools/watcher/watcher_ctl.sh start 30

نکته‌ها:
- یه کلاینت بیشتر روی سشن نباشه (یا واتچر یا ابزار دستی، نه هر دو)
- state.json پنجره ۷ روزه رو نگه می‌داره؛ اگه نبود، پنجره تازه از الان شروع میشه
- فایل حاوی سشن تلگرامه، هیچ‌وقت به کسی نده
"""


class Watcher:
    def __init__(self, catchup_minutes: int):
        self.catchup_minutes = catchup_minutes
        self.state = load_state()
        self.config = load_config()
        self.pending: dict[int, float] = {}
        self.pending_texts: dict[int, str] = {}
        self.owner_active: dict[int, float] = {}
        self.per_chat_sent: dict[int, list] = {}
        self.global_sent: list = []
        self.send_lock = asyncio.Lock()
        self.shutting_down = False
        self.exit_code = 0
        self.client: TelegramClient | None = None
        self.started_ts = time.time()
        self.today_incoming = 0
        self.today_replies = 0

    # ---------- state ----------
    def save_state(self):
        atomic_write_json(STATE_PATH, self.state)

    def save_config(self, autobackup: bool = False):
        atomic_write_json(CONFIG_PATH, self.config)
        try:
            os.chmod(CONFIG_PATH, 0o600)
        except OSError:
            pass
        if autobackup:
            asyncio.get_running_loop().create_task(
                self.auto_backup("تغییر تنظیمات"))

    def expired(self) -> bool:
        return time.time() > self.state["window_end"]

    # ---------- blacklist ----------
    def is_blacklisted(self, user) -> bool:
        for b in self.config.get("blacklist", []):
            if b.get("id") and b.get("id") == user.id:
                return True
            if b.get("username") and \
                    (getattr(user, "username", "") or "").lower() == \
                    b["username"]:
                return True
        return False

    # ---------- rate limits ----------
    def allow(self, chat_id: int) -> bool:
        now = time.time()
        self.per_chat_sent[chat_id] = [
            t for t in self.per_chat_sent.get(chat_id, []) if now - t < 3600]
        self.global_sent[:] = [t for t in self.global_sent if now - t < 3600]
        return (len(self.per_chat_sent[chat_id]) < PER_CHAT_H
                and len(self.global_sent) < GLOBAL_H)

    def record_send(self, chat_id: int):
        now = time.time()
        self.per_chat_sent.setdefault(chat_id, []).append(now)
        self.global_sent.append(now)
        self.state["replies_total"] = int(
            self.state.get("replies_total", 0)) + 1
        self.today_replies += 1

    # ---------- helpers ----------
    @staticmethod
    def is_bot_own_text(text: str) -> bool:
        """Every watcher message ends with the footer — that's the marker.
        Accepts both the current and the old footer (history)."""
        t = (text or "").rstrip()
        return bool(t) and any(t.endswith(m) for m in FOOTER_MARKS)

    def effective_system_prompt(self) -> str:
        ins = self.config.get("instructions") or []
        if not ins:
            return SYSTEM_PROMPT
        return SYSTEM_PROMPT + "\n\nقوانین دائمی که مالک بعدا گفته (حکمشون " \
               "لازمه، مگه با قوانین ایمنی بالا تضاد داشته باشن):\n" + \
               "\n".join(f"- {i}" for i in ins)

    # ---------- customer reply pipeline ----------
    async def build_prompt(self, chat_id: int, text: str) -> str:
        lines = ["گفتگوی اخیر این چت (نقش‌ها: مشتری / تو):"]
        try:
            msgs = await self.client.get_messages(chat_id, limit=10)
            for m in reversed(msgs):
                if not m.message:
                    continue
                who = "تو" if m.out else "مشتری"
                lines.append(f"{who}: {m.message[:200]}")
        except Exception as e:  # noqa: BLE001
            WLOG.log("history_fail", chat_id=chat_id, err=str(e)[:80])
        lines.append("")
        lines.append(f"پیام جدید مشتری که باید همین الان جواب بدی: {text}")
        lines.append("")
        lines.append("حالا فقط متن جوابت رو بنویس، طبیعی و آدمیزادی:")
        return "\n".join(lines)

    async def reply_chat(self, chat_id: int, text: str):
        if self.shutting_down:
            return
        if time.time() - self.owner_active.get(chat_id, 0) < OWNER_ACTIVE_S:
            WLOG.log("skip_owner_active", chat_id=chat_id)
            return
        if not self.allow(chat_id):
            WLOG.log("rate_limited", chat_id=chat_id)
            return
        if text == MEDIA_PLACEHOLDER:
            answer = MEDIA_REPLY
        else:
            try:
                prompt = await self.build_prompt(chat_id, text)
                answer = await llm_reply(prompt,
                                         self.effective_system_prompt())
            except RuntimeError:
                answer = FALLBACK_TEXT
        answer = answer + FOOTER  # MANDATORY — appended by code
        WLOG.log("reply_send", chat_id=chat_id, answer=answer[:120])
        async with self.send_lock:
            await asyncio.sleep(random.uniform(4, 6))
            for attempt in range(2):
                try:
                    await self.client.send_message(chat_id, answer)
                    break
                except FloodWaitError as e:
                    WLOG.log("floodwait", chat_id=chat_id, wait=e.seconds)
                    if attempt == 1 or e.seconds > 1800:
                        break
                    await asyncio.sleep(e.seconds + 2)
            self.record_send(chat_id)
            self.save_state()

    async def debounce_loop(self):
        while not self.shutting_down:
            now = time.time()
            for chat_id, due in list(self.pending.items()):
                if now >= due:
                    text = self.pending_texts.pop(chat_id, None)
                    self.pending.pop(chat_id, None)
                    if text and not self.shutting_down:
                        asyncio.create_task(self.reply_chat(chat_id, text))
            await asyncio.sleep(1)

    # ---------- backup ----------
    async def send_backup(self, reason: str) -> str:
        try:
            path = build_backup_zip()
            size_kb = os.path.getsize(path) // 1024
            stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            caption = (f"📦 بکاپ کامل دستیار Z\nدلیل: {reason}\nزمان: {stamp}"
                       f"\nحجم: {size_kb} KB"
                       "\n\n⚠️ داخلش سشن تلگرام و تنظیمات و کدهاست؛"
                       "هیچ‌وقت به کس دیگه نده. راهنمای بازگردانی داخل فایله."
                       + FOOTER)
            await self.client.send_file(OWNER_USER_ID, path,
                                        caption=caption, supports_streaming=False)
            os.remove(path)
            WLOG.log("backup_sent", reason=reason)
            return f"✅ بکاپ ساخته شد و همین الان تو همین سیو مسیج برات " \
                   f"رفت ({size_kb} KB)"
        except Exception as e:  # noqa: BLE001
            WLOG.log("backup_fail", err=str(e)[:100])
            return "❌ ساختن/فرستادن بکاپ گیر کرد، یه بار دیگه امتحان کن."

    async def auto_backup(self, reason: str):
        last = float(self.config.get("last_autobackup_ts", 0))
        if time.time() - last < AUTOBACKUP_MIN_GAP:
            return
        self.config["last_autobackup_ts"] = time.time()
        atomic_write_json(CONFIG_PATH, self.config)  # no re-trigger
        await self.send_backup(reason)

    # ---------- broadcast ----------
    async def collect_broadcast_targets(self, days=14) -> list:
        since = time.time() - days * 86400
        targets = []
        async for d in self.client.iter_dialogs(limit=150):
            if not isinstance(d.entity, User):
                continue
            if getattr(d.entity, "bot", False):
                continue
            if d.entity.id == OWNER_USER_ID or is_service_user(d.entity):
                continue
            if self.is_blacklisted(d.entity):
                continue
            if d.message is None or d.message.date is None:
                continue
            if d.message.date.timestamp() < since:
                continue
            try:
                msgs = await self.client.get_messages(d.id, limit=5)
            except Exception:  # noqa: BLE001
                continue
            if any(not m.out and m.date and m.date.timestamp() > since
                   for m in msgs):
                targets.append(d.entity.id)
            if len(targets) >= BROADCAST_MAX:
                break
        return targets

    async def prepare_broadcast(self, text: str):
        targets = await self.collect_broadcast_targets()
        if not targets:
            await self.ack("کسی تو دوهفته اخیر پیام نداده که بخوام "
                           "برادکست بفرستم 🤷‍♂️")
            return
        self.config["pending_broadcast"] = {
            "text": text, "targets": targets,
            "expires": time.time() + BROADCAST_CONFIRM_S,
        }
        atomic_write_json(CONFIG_PATH, self.config)
        WLOG.log("broadcast_pending", count=len(targets))
        await self.ack(
            f"📢 می‌خوای این پیام به {len(targets)} تا چت مشتری‌های اخیر "
            f"بره:\n\n«{text[:150]}»\n\nمی‌فرستم؟ فقط بنویس «بله» "
            f"(تا ۱۰ دقیقه فرصت داری، با «نه» لغوش می‌کنی)")

    async def execute_broadcast(self):
        pb = self.config.pop("pending_broadcast", None)
        if not pb:
            await self.ack("چیزی تو صف نبود.")
            return
        sent = fail = 0
        text = (pb["text"] or "").strip()
        if not self.is_bot_own_text(text):
            text = text + FOOTER
        for chat_id in pb["targets"]:
            try:
                await asyncio.sleep(random.uniform(6, 10))
                await self.client.send_message(chat_id, text)
                sent += 1
            except FloodWaitError as e:
                WLOG.log("floodwait", chat_id=chat_id, wait=e.seconds)
                if e.seconds <= 900:
                    await asyncio.sleep(e.seconds + 2)
                    try:
                        await self.client.send_message(chat_id, text)
                        sent += 1
                        continue
                    except Exception:  # noqa: BLE001
                        pass
                fail += 1
            except Exception as e:  # noqa: BLE001
                WLOG.log("broadcast_fail", chat_id=chat_id,
                         err=str(e)[:60])
                fail += 1
        atomic_write_json(CONFIG_PATH, self.config)
        WLOG.log("broadcast_done", sent=sent, fail=fail)
        await self.ack(f"📢 برودکست رفت: {sent} تا موفق"
                       + (f"، {fail} تا خطا خورد" if fail else ""))

    # ---------- owner command channel (Saved Messages) ----------
    def status_text(self) -> str:
        left = self.state["window_end"] - time.time()
        if left > 3650 * 86400:
            window = "همیشه فعال (بدون محدودیت زمانی، طبق دستور مالک)"
        elif left <= 0:
            window = "پنجره تموم شده"
        else:
            window = (f"{int(left // 86400)} روز و "
                      f"{int(left % 86400 // 3600)} ساعت")
        bl = ", ".join("@" + b["username"]
                       for b in self.config.get("blacklist", [])
                       if b.get("username")) or "خالی"
        ins = self.config.get("instructions") or []
        up_h = (time.time() - self.started_ts) / 3600
        lines = [
            "📊 وضعیت Z:",
            "⚡ مدل: glm-4-plus (قوی‌ترین) + حالت تفکر فعال",
            f"⏳ وضعیت: {window}",
            f"💬 از آخرین استارت: {self.today_incoming} پیام اومده، "
            f"{self.today_replies} جواب رفته",
            f"📈 کل جواب‌های این دوره: {self.state.get('replies_total', 0)}",
            f"⏱ آپ‌تایم این پروسه: {up_h:.1f} ساعت",
            f"🚫 بلاک‌لیست: {bl}",
            f"📌 قوانین دائمی: {len(ins)} مورد",
        ]
        for i in ins[:10]:
            lines.append(f"   • {i[:80]}")
        return "\n".join(lines)

    async def ack(self, text: str):
        try:
            await self.client.send_message(OWNER_USER_ID, text + FOOTER)
        except Exception as e:  # noqa: BLE001
            WLOG.log("ack_fail", err=str(e)[:80])

    async def blacklist_add(self, usernames: list) -> list:
        added = []
        for raw in usernames or []:
            uname = normalize_username(str(raw))
            if not uname:
                continue
            if any(b.get("username") == uname
                   for b in self.config["blacklist"]):
                continue
            entry = {"username": uname}
            try:
                u = await self.client.get_entity(uname)
                entry["id"] = u.id
                entry["name"] = (u.first_name or "") + " " + \
                    (u.last_name or "")
            except Exception:  # noqa: BLE001
                pass
            self.config["blacklist"].append(entry)
            added.append("@" + uname)
        if added:
            self.save_config(autobackup=True)
        return added

    def blacklist_remove(self, usernames: list) -> list:
        removed = []
        for raw in usernames or []:
            uname = normalize_username(str(raw))
            before = len(self.config["blacklist"])
            self.config["blacklist"] = [
                b for b in self.config["blacklist"]
                if b.get("username") != uname]
            if len(self.config["blacklist"]) < before:
                removed.append("@" + uname)
        if removed:
            self.save_config(autobackup=True)
        return removed

    async def command_send_message(self, target: str, text: str) -> str:
        if not target or not text:
            return "مقصد یا متن مشخص نبود، دقیق‌تر بگو."
        try:
            entity = await self.client.get_entity(target.strip())
        except Exception:  # noqa: BLE001
            return f"نتونستم «{target}» رو پیدا کنم."
        try:
            if not self.is_bot_own_text(text):
                text = text + FOOTER
            await self.client.send_message(entity, text)
            WLOG.log("owner_cmd_send", target=target, text=text[:80])
            return f"✅ به {target} پیام دادم."
        except Exception as e:  # noqa: BLE001
            return f"❌ ارسال گیر کرد: {str(e)[:80]}"

    async def handle_owner_command(self, text: str):
        WLOG.log("owner_command", text=text[:150])
        # pending broadcast confirmation?
        pb = self.config.get("pending_broadcast")
        if pb:
            if time.time() > pb.get("expires", 0):
                self.config.pop("pending_broadcast", None)
                atomic_write_json(CONFIG_PATH, self.config)
                pb = None
        if pb:
            norm = text.strip().replace("‌", "")
            if norm in CONFIRM_WORDS:
                await self.ack("برو که رفت 🚀")
                await self.execute_broadcast()
                return
            if norm in CANCEL_WORDS:
                self.config.pop("pending_broadcast", None)
                atomic_write_json(CONFIG_PATH, self.config)
                await self.ack("لغو شد ✋")
                return
            await self.ack("منتظر «بله» یا «نه» برای برودکست بودم؛ "
                           "چون یه چیز دیگه فرستادی صف لغو شد. دوباره "
                           "بگو تا از اول بچینمش.")
            self.config.pop("pending_broadcast", None)
            atomic_write_json(CONFIG_PATH, self.config)
            # fall through: parse the new command normally
        if DANGER_RE.search(text or ""):
            await self.ack("⛔ دستورای مربوط به بازنشانی و دو مرحله‌ای رو "
                           "به هیچ شکلی اجرا نمی‌کنم؛ اینا فقط با خودته.")
            return
        try:
            actions = await llm_command(text)
        except RuntimeError:
            await self.ack(FALLBACK_TEXT)
            return
        for a in actions:
            action = a.get("action")
            WLOG.log("owner_cmd_parsed", action=action)
            if action == "blacklist_add":
                added = await self.blacklist_add(a.get("usernames"))
                if added:
                    await self.ack("🚫 باشه، از این به بعد به اینا جواب "
                                   "نمی‌دم: " + ", ".join(added))
                else:
                    await self.ack("کسی برای بلاک پیدا نشمدم 🤔")
            elif action == "blacklist_remove":
                removed = self.blacklist_remove(a.get("usernames"))
                await self.ack("✅ دوباره جواب‌شون میدم: "
                               + (", ".join(removed) if removed
                                  else "تو لیست نبودن"))
            elif action == "send_message":
                await self.ack(await self.command_send_message(
                    a.get("target", ""), a.get("text", "")))
            elif action == "status":
                await self.ack(self.status_text())
            elif action == "remember":
                ins = (a.get("instruction") or "").strip()
                if ins:
                    self.config.setdefault("instructions", []).append(ins)
                    self.save_config(autobackup=True)
                    await self.ack("📌 ثبت شد، از این به بعد همه جواب‌ها "
                                   "طبقش می‌ره:\n" + ins)
                else:
                    await self.ack("سری چی گفتی؟ دقیق‌تر بگو قانون چیه.")
            elif action == "forget_instructions":
                n = len(self.config.get("instructions") or [])
                self.config["instructions"] = []
                self.save_config(autobackup=True)
                await self.ack(f"🗑 {n} تا قانون قبلی پاک شد.")
            elif action == "backup":
                await self.ack(await self.send_backup("درخواست خود مالک"))
            elif action == "broadcast":
                btext = (a.get("text") or "").strip()
                if btext:
                    await self.prepare_broadcast(btext)
                else:
                    await self.ack("متن برودکست رو نگفتی، بگو چی بره.")
            else:  # chat
                reply = (a.get("reply") or "چی گفتی؟ 😅").strip()
                await self.ack(reply)

    # ---------- catchup after downtime ----------
    async def catchup(self):
        since = time.time() - self.catchup_minutes * 60
        WLOG.log("catchup_scan", minutes=self.catchup_minutes)
        try:
            dialogs = await self.client.get_dialogs(limit=60)
        except Exception as e:  # noqa: BLE001
            WLOG.log("catchup_dialogs_fail", err=str(e)[:100])
            return
        for d in dialogs:
            if not isinstance(d.entity, User):
                continue
            if getattr(d.entity, "bot", False):
                continue
            if d.entity.id == OWNER_USER_ID:
                continue
            if is_service_user(d.entity):
                continue
            if self.is_blacklisted(d.entity):
                continue
            try:
                msgs = await self.client.get_messages(d.id, limit=3)
            except Exception:  # noqa: BLE001
                continue
            if not msgs:
                continue
            for m in msgs:
                if m.out and m.date and m.date.timestamp() > since \
                        and not self.is_bot_own_text(m.message or ""):
                    self.owner_active[d.id] = m.date.timestamp()
            last = msgs[0]
            if last.out or last.date is None:
                continue
            if last.date.timestamp() < since:
                continue
            text = (last.message or "").strip() or MEDIA_PLACEHOLDER
            if self.is_bot_own_text(text):
                continue
            WLOG.log("catchup_found", chat_id=d.id, text=text[:80])
            self.pending[d.id] = time.time() + 2
            self.pending_texts[d.id] = text
            await asyncio.sleep(0.5)

        # owner commands left in Saved Messages during downtime
        try:
            last_sm = int(self.state.get("last_sm_id", 0))
            sm_msgs = await self.client.get_messages(OWNER_USER_ID, limit=5)
            for m in sorted(sm_msgs, key=lambda x: x.id):
                if m.id <= last_sm or not m.out or m.date is None:
                    continue
                if m.date.timestamp() < since:
                    continue
                text = (m.message or "").strip()
                if not text or self.is_bot_own_text(text):
                    continue
                WLOG.log("catchup_command", text=text[:80])
                self.state["last_sm_id"] = m.id
                self.save_state()
                asyncio.create_task(self.handle_owner_command(text))
        except Exception as e:  # noqa: BLE001
            WLOG.log("catchup_sm_fail", err=str(e)[:80])

    # ---------- watchdog (pause / expiry / panel backup trigger) ----------
    async def watchdog(self):
        while not self.shutting_down:
            if os.path.exists(PAUSE_PATH):
                WLOG.log("pause_exit")
                self.exit_code = 0
                break
            if os.path.exists(BACKUP_TRIGGER):
                try:
                    os.remove(BACKUP_TRIGGER)
                except OSError:
                    pass
                WLOG.log("backup_trigger")
                asyncio.create_task(self.send_backup("دکمه بکاپ فوری پنل مالک"))
            if self.expired():
                WLOG.log("expired",
                         replies_total=self.state.get("replies_total", 0))
                self.exit_code = 42
                break
            await asyncio.sleep(10)
        self.shutting_down = True
        try:
            await self.client.disconnect()
        except Exception:  # noqa: BLE001
            pass

    # ---------- main ----------
    async def run(self) -> int:
        session_string = get_session_string()
        if not session_string:
            WLOG.log("fatal", err="no session string — login required")
            return 3
        api_id = int(get_env("TELEGRAM_API_ID"))
        api_hash = get_env("TELEGRAM_API_HASH")
        self.client = TelegramClient(
            StringSession(session_string), api_id, api_hash,
            device_model="Z Watcher", system_version="linux")
        await self.client.connect()
        me = await self.client.get_me()
        if not me:
            WLOG.log("fatal", err="auth failed — session dead")
            await self.client.disconnect()
            return 3
        WLOG.log("start", me=f"@{me.username}", id=me.id,
                 replies_total=self.state.get("replies_total", 0),
                 window_end=datetime.fromtimestamp(
                     self.state["window_end"], timezone.utc).isoformat())
        self.state["started_count"] = int(
            self.state.get("started_count", 0)) + 1
        self.save_state()

        @self.client.on(events.NewMessage(incoming=True))
        async def on_incoming(event):  # noqa: WPS430
            try:
                chat = await event.get_chat()
            except Exception:  # noqa: BLE001
                return
            if not isinstance(chat, User):
                return  # DMs only
            if getattr(chat, "bot", False):
                return
            if chat.id == OWNER_USER_ID:
                return
            if is_service_user(chat):
                return
            if self.is_blacklisted(chat):
                WLOG.log("blacklisted_skip", chat_id=chat.id,
                         user=getattr(chat, "username", ""))
                return
            text = (event.message.message or "").strip() or MEDIA_PLACEHOLDER
            self.today_incoming += 1
            self.pending[event.chat_id] = time.time() + DEBOUNCE_S
            self.pending_texts[event.chat_id] = text
            WLOG.log("incoming", chat_id=event.chat_id, text=text[:80])

        @self.client.on(events.NewMessage(outgoing=True))
        async def on_outgoing(event):  # noqa: WPS430
            text = event.message.message or ""
            if self.is_bot_own_text(text):
                return  # our own send (footer marker)
            if event.chat_id == OWNER_USER_ID:
                # Saved Messages = owner command channel
                if self.config.get("saved_messages_commands", True) \
                        and text.strip() \
                        and event.message.id > \
                        int(self.state.get("last_sm_id", 0)):
                    self.state["last_sm_id"] = event.message.id
                    self.save_state()
                    asyncio.create_task(self.handle_owner_command(
                        text.strip()))
                return
            # personal message from the owner in a customer chat -> silent
            self.owner_active[event.chat_id] = time.time()
            WLOG.log("owner_msg", chat_id=event.chat_id)

        tasks = [
            asyncio.create_task(self.debounce_loop()),
            asyncio.create_task(self.watchdog()),
        ]
        try:
            await self.catchup()
            await self.client.run_until_disconnected()
        finally:
            self.shutting_down = True
            for t in tasks:
                t.cancel()
        return self.exit_code


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catchup-minutes", type=int,
                    default=CATCHUP_DEFAULT_MIN)
    args = ap.parse_args()
    if os.path.exists(LIVE_LOCK):
        try:
            pid = int(open(LIVE_LOCK).read().strip())
            os.kill(pid, 0)
            print(f"REFUSING: watcher.py already running (pid {pid}). "
                  "One session = one client!", file=sys.stderr)
            sys.exit(4)
        except (ValueError, ProcessLookupError, PermissionError, OSError):
            pass  # stale lock
    with open(LIVE_LOCK, "w") as f:
        f.write(str(os.getpid()))
    try:
        code = asyncio.run(Watcher(args.catchup_minutes).run())
    finally:
        try:
            os.remove(LIVE_LOCK)
        except OSError:
            pass
    sys.exit(code or 0)


if __name__ == "__main__":
    main()
