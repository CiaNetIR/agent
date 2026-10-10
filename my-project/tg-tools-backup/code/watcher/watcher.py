#!/usr/bin/env python3
"""@VpnStarZ — always-on AI auto-responder (v6).

v8 (owner request, 2026-10-08 evening — "agent suite"):
- SENDQ: a small queue dir (sendq/*.json) consumed by the watchdog every
  10 s — {chat, text | file, caption} — so OTHER services (the agent core
  on :3004) can ship REAL Telegram messages/files through THIS client
  without ever creating a second Telegram connection (one session = one
  client, never violated). Failed entries survive as *.failed for audit.
- IMGREQ: owner command «image» (تصویر بساز / عکست بکش ...) drops
  imgreq/req-*.json; the agent core polls it, generates the image with the
  image model and replies through sendq — Telegram → AI image → Telegram.

v7 (owner request, 2026-10-08 — "panel LLM settings + multi-account"):
- LLM settings (thinking / retries / rate limits / footer / persona /
  command prompt) are now owner-editable overrides stored in
  watcher-config.json via the web panel; the code constants above are only
  fallbacks. llm_settings_dict() reports the EFFECTIVE values.
- Multi-account instances: when W_INSTANCE_DIR is set, this process is an
  isolated watcher for ONE extra Telegram account (panel «اکانت‌ها»,
  launched by ~/tg-tools/instances_ctl.sh). Main watcher behaviour unchanged.

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
import threading
import time
import uuid
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

# ---- multi-account instances (panel «اکانت‌ها») --------------------------
# When W_INSTANCE_DIR is set (launched by ~/tg-tools/instances_ctl.sh) this
# process is an ISOLATED watcher for one extra Telegram account: state, log,
# lock, pause-file, config and session all live inside the instance dir.
# Owner commands reach it as DMs from the main account (OWNER_USER_ID) or
# via that account's own Saved Messages. The main watcher never sets this.
W_INSTANCE_DIR = os.environ.get("W_INSTANCE_DIR", "")
INSTANCE_ENV = ""
# v8 queues live next to the rest of this watcher's state (main or instance)
_QROOT = W_INSTANCE_DIR or HERE
SENDQ_DIR = os.path.join(_QROOT, "sendq")
IMGREQ_DIR = os.path.join(_QROOT, "imgreq")
if W_INSTANCE_DIR:
    STATE_PATH = os.path.join(W_INSTANCE_DIR, "state.json")
    LOG_PATH = os.path.join(W_INSTANCE_DIR, "wlog.jsonl")
    PAUSE_PATH = os.path.join(W_INSTANCE_DIR, "PAUSE")
    LIVE_LOCK = os.path.join(W_INSTANCE_DIR, "watcher.lock")
    BACKUP_TRIGGER = os.path.join(W_INSTANCE_DIR, "BACKUP_NOW")
    CONFIG_PATH = os.path.join(W_INSTANCE_DIR, "config.json")
    INSTANCE_ENV = os.path.join(W_INSTANCE_DIR, "env")

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
- سرویس نامحدود: یک سرویس واحد برای اندروید و ویندوز — ماهانه ۳۹۹ هزار تومن، با اپلیکیشن اختصاصی خودمون
- سرویس حجمی: برای آیفون و سایر دستگاه‌ها — هر گیگ ۱۵ هزار تومن
- اندروید و ویندوز دو محصول جدا نیستن؛ هر دو همین سرویس نامحدودن
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
- image: مالک خواسته با هوش مصنوعی تصویر/عکس ساخته بشه و براش فرستاده شه (تصویر بساز / عکس بکش / یه عکس از ... در بیار / لوگو بساز). فیلد prompt = توصیف کامل و دقیق تصویر، همون‌جوری که مالک گفته یا کامل‌ترش (اگه فارسی بود، خودت همون متن فارسی رو دقیق نگه دار و فقط جزئیات گمشده رو اضافه کن).
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
# Part B: turn-buffer cap — aggregated fragments never blow up the prompt
TURN_MAX_CHARS = 3500
# Part J: single payment follow-up (armed when the card number is sent)
FOLLOWUP_DELAY_S = 10 * 60
FOLLOWUP_TEXTS = ("برای پرداخت مشکلی پیش اومده؟",
                  "همه چی اوکیه؟ اگه برای پرداخت گیر کردی بگو 🙏🏻")
# Part J: follow-up arms only when this card number appears in OUR reply
CARD_RE = re.compile(r"6219[ \-]?8614[ \-]?9432[ \-]?5490")


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


# ---- owner-editable overrides (panel «هوش مصنوعی») -----------------------
# Every value below reads watcher-config.json FIRST and falls back to the
# code constants. An override is removed by deleting the key (or writing "").

def _cfg_str(cfg: dict, key: str, fallback: str) -> str:
    v = cfg.get(key)
    if isinstance(v, str) and v.strip():
        return v.strip()
    return fallback


def _cfg_bool(cfg: dict, key: str, fallback: bool) -> bool:
    v = cfg.get(key)
    return v if isinstance(v, bool) else fallback


def _cfg_int(cfg: dict, key: str, fallback: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(cfg.get(key, fallback))))
    except (TypeError, ValueError):
        return fallback


def _rate_limits(cfg: dict) -> dict:
    rl = cfg.get("rate_limits")
    rl = rl if isinstance(rl, dict) else {}
    return {
        "per_chat_hour": _cfg_int(rl, "per_chat_hour", PER_CHAT_H, 1, 200),
        "global_hour": _cfg_int(rl, "global_hour", GLOBAL_H, 1, 1000),
        "debounce_s": _cfg_int(rl, "debounce_s", DEBOUNCE_S, 0, 300),
    }


def effective_footer(cfg: dict) -> str:
    """Footer override from the panel config ("" → code default)."""
    v = cfg.get("footer")
    if isinstance(v, str) and v.strip():
        return "\n\n" + v.strip()
    return FOOTER


def footer_marks(cfg: dict) -> list:
    """All footer wordings that mark a message as ours (default/old/custom)."""
    f = effective_footer(cfg).strip()
    marks = list(FOOTER_MARKS)
    if f not in marks:
        marks.append(f)
    return marks


def _instance_env_value(key: str) -> str:
    """Read a key from the instance env file (instance mode only)."""
    if not INSTANCE_ENV:
        return ""
    try:
        with open(INSTANCE_ENV, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith(key + "="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def _z_ai_call(prompt: str, system: str) -> str:
    """Blocking z-ai chat CLI call — always inside LLM_POOL executor.
    Uses glm-4-plus — the strongest (and, verified 2026-10, the ONLY) model
    this endpoint serves; every `model` value is normalized to glm-4-plus.
    Thinking mode and retries are owner-configurable via watcher-config.json
    (panel «هوش مصنوعی» tab).

    429 («Too many requests») is handled through a CROSS-PROCESS circuit
    breaker shared with the agent core (:3004): any 429 bumps a cooldown
    file (escalating 30→60→120→300→600 s) and every caller — this watcher,
    the panel chat, video jobs — backs off until it clears. Fast retries
    were making it worse (each burst re-arms the lockout), which is why a
    customer used to get the FALLBACK text within seconds. Now a reply may
    spend up to REPLY_BUDGET_S waiting out a short lockout; a long lockout
    fails fast (honest «چند دقیقه بعد») instead of poking the API."""
    cfg = load_config()
    thinking = _cfg_bool(cfg, "thinking", LLM_THINKING)
    retries = _cfg_int(cfg, "retries", LLM_RETRIES, 1, 5)
    # UNIQUE file per call — the two LLM_POOL threads used to share a single
    # .llm_<pid>.json, so overlapping calls could read each other's output
    # (a reply built for one context delivered to another chat) or parse a
    # half-written file (spurious llm_fail → FALLBACK text to a customer)
    out_file = os.path.join(
        HERE, f".llm_{os.getpid()}_{uuid.uuid4().hex[:8]}.json")
    cmd = [Z_AI, "chat", "-p", prompt, "-s", system, "-o", out_file]
    if thinking:
        cmd.append("-t")  # flag must come AFTER the chat subcommand
    last_err = ""
    budget_end = time.time() + REPLY_BUDGET_S
    try:
        for attempt in range(1, retries + 1):
            # cross-process cooldown → wait it out (while we still have budget)
            wait_s = (_cooldown_until_ms() - time.time() * 1000.0) / 1000.0
            if wait_s > 0:
                if time.time() + wait_s > budget_end:
                    WLOG.log("llm_rate_limited", attempt=attempt,
                             note="cooldown outlives budget — fallback now",
                             cooldown_s=int(wait_s))
                    break
                time.sleep(wait_s + 0.5)
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
                _rl_clear_streak()
                return text
            except (subprocess.TimeoutExpired, RuntimeError,
                    json.JSONDecodeError, OSError) as e:
                last_err = str(e)
                if _rl_is_rate_limit(last_err):
                    until_ms = _rl_bump_cooldown()
                    WLOG.log("llm_rate_limited", attempt=attempt,
                             cooldown_s=max(0, int((until_ms / 1000.0)
                                                  - time.time())))
                    # loop → next iteration waits for the cooldown (budget-capped)
                else:
                    WLOG.log("llm_fail", attempt=attempt, err=last_err[:120])
                    if attempt < retries:
                        time.sleep(2)
    finally:
        try:
            os.remove(out_file)
        except OSError:
            pass
    raise RuntimeError(last_err or "llm failed")


# ---- 429 circuit breaker state (shared with the agent core via a file) ----
# File format: {"until": <epoch ms>, "reason": "429", "at": <epoch ms>}
LLM_COOLDOWN_FILE = "/home/z/agent-files/llm-cooldown.json"
COOLDOWN_STEPS_S = [30, 60, 120, 300, 600]  # escalating, cap 10 min
REPLY_BUDGET_S = 170  # max wall-clock a reply waits out a lockout before fallback
_RL_LOCK = threading.Lock()
_RL = {"until_ms": 0.0, "streak": 0, "checked": 0.0}


def _cooldown_until_ms() -> float:
    """effective cooldown end (epoch ms) — file value mirrored in memory,
    re-read at most every 3 s; never lower than what we already know."""
    now = time.time()
    if now - _RL["checked"] > 3:
        try:
            with open(LLM_COOLDOWN_FILE, "r", encoding="utf-8") as f:
                until = float(json.load(f).get("until") or 0)
            if until > _RL["until_ms"]:
                _RL["until_ms"] = until
        except (OSError, ValueError):
            pass
        _RL["checked"] = now
    return _RL["until_ms"]


def _rl_bump_cooldown() -> float:
    """a 429 happened → escalate the shared cooldown, return its end (ms)"""
    with _RL_LOCK:
        step = COOLDOWN_STEPS_S[min(_RL["streak"], len(COOLDOWN_STEPS_S) - 1)]
        _RL["streak"] += 1
        until_ms = max(_cooldown_until_ms(), (time.time() + step) * 1000.0)
        _RL["until_ms"] = until_ms
        _RL["checked"] = time.time()
        try:
            os.makedirs(os.path.dirname(LLM_COOLDOWN_FILE), exist_ok=True)
            tmp = LLM_COOLDOWN_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"until": until_ms, "reason": "429",
                           "at": time.time() * 1000.0}, f)
            os.replace(tmp, LLM_COOLDOWN_FILE)
        except OSError:
            pass  # best effort — the in-memory value still works here
    return until_ms


def _rl_clear_streak() -> None:
    with _RL_LOCK:
        _RL["streak"] = 0


def _rl_is_rate_limit(err_text: str) -> bool:
    return "429" in err_text or "Too many requests" in err_text


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
    render_llm_settings_txt() inside every backup zip. Reports the
    EFFECTIVE values (watcher-config.json overrides over code fallbacks)."""
    cfg = load_config()
    keys = ("persona", "command_prompt", "footer", "thinking",
            "retries", "rate_limits")
    return {
        "persona": _cfg_str(cfg, "persona", SYSTEM_PROMPT),
        "command_prompt": _cfg_str(cfg, "command_prompt",
                                   COMMAND_SYSTEM_PROMPT),
        "model": "glm-4-plus",
        "thinking": _cfg_bool(cfg, "thinking", LLM_THINKING),
        "retries": _cfg_int(cfg, "retries", LLM_RETRIES, 1, 5),
        "rate_limits": _rate_limits(cfg),
        "footer": effective_footer(cfg).strip(),
        "instructions": cfg.get("instructions") or [],
        "blacklist": [{"username": b.get("username", ""),
                       "name": b.get("name", "")}
                      for b in cfg.get("blacklist") or []],
        "prices": {"android_monthly": "۳۹۹ هزار تومن",
                   "per_gb": "۱۵ هزار تومن"},
        "customized": {k: k in cfg for k in keys},
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
        for arcname, src in _backup_files():
            if os.path.exists(src):
                z.write(src, arcname)
        z.writestr("RESTORE.md", RESTORE_GUIDE)
        z.writestr("Z-LLM-SETTINGS.txt", render_llm_settings_txt())
    return path


def _backup_files() -> list:
    """BACKUP_FILES for the current mode (main watcher vs instance)."""
    if W_INSTANCE_DIR:
        return [
            ("watcher/watcher.py", os.path.join(HERE, "watcher.py")),
            ("watcher/supervisor.sh", os.path.join(HERE, "supervisor.sh")),
            ("tg-tools/instances_ctl.sh",
             os.path.join(TG_TOOLS, "instances_ctl.sh")),
            ("instance/config.json", CONFIG_PATH),
            ("instance/state.json", STATE_PATH),
            ("instance/env", INSTANCE_ENV),
        ]
    return BACKUP_FILES


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
        # Part Q: rate-limit counters survive restarts (a restart used to
        # zero the per-chat/global budget mid-hour) — hydrate from state.
        _now = time.time()
        try:
            for _c, _ts in (self.state.get("rl_per_chat") or {}).items():
                _keep = [t for t in _ts
                         if isinstance(t, (int, float)) and _now - t < 3600]
                if _keep:
                    self.per_chat_sent[int(_c)] = _keep
        except (TypeError, ValueError):
            pass
        self.global_sent = [
            t for t in (self.state.get("rl_global") or [])
            if isinstance(t, (int, float)) and _now - t < 3600]
        # Part U: outbound message-id registry (pruned >48h on load)
        try:
            self.sent_ids = {
                int(k): v for k, v in (self.state.get("sent_ids") or {}).items()
                if isinstance(v, (int, float)) and _now - v < 48 * 3600}
        except (TypeError, ValueError):
            self.sent_ids = {}
        # Part J: armed payment follow-ups + last incoming per chat
        try:
            self.followup_armed = {
                int(k): v for k, v in (self.state.get("followups") or {}).items()
                if isinstance(v, dict) and v.get("due", 0) > _now - 3600
                and not v.get("fired")}
        except (TypeError, ValueError, AttributeError):
            self.followup_armed = {}
        # chat_id -> (ts, was_media) — follow-up cancellation evidence
        self.last_incoming: dict[int, tuple] = {}

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
        rl = _rate_limits(self.config)
        self.per_chat_sent[chat_id] = [
            t for t in self.per_chat_sent.get(chat_id, []) if now - t < 3600]
        self.global_sent[:] = [t for t in self.global_sent if now - t < 3600]
        return (len(self.per_chat_sent[chat_id]) < rl["per_chat_hour"]
                and len(self.global_sent) < rl["global_hour"])

    def record_send(self, chat_id: int):
        now = time.time()
        self.per_chat_sent.setdefault(chat_id, []).append(now)
        self.global_sent.append(now)
        # Part Q: mirror the 1h-window counters into state.json so a
        # restart keeps the rate-limit budget instead of resetting it.
        self.state["rl_per_chat"] = {
            str(c): [t for t in ts if now - t < 3600]
            for c, ts in self.per_chat_sent.items()}
        self.state["rl_global"] = [t for t in self.global_sent
                                   if now - t < 3600]
        self.state["replies_total"] = int(
            self.state.get("replies_total", 0)) + 1
        self.today_replies += 1

    # ---------- helpers ----------
    def is_bot_own_text(self, text: str) -> bool:
        """Legacy footer-text discriminator (pre-registry messages).
        Prefer is_ours() — the sent-id registry survives footer edits."""
        t = (text or "").rstrip()
        return bool(t) and any(t.endswith(m) for m in footer_marks(self.config))

    def register_sent(self, msg) -> None:
        """Part U: record OUR outbound message id — the reliable
        bot-vs-owner discriminator (footer match stays only as the legacy
        fallback). Registry is pruned >48h and bounded."""
        mid = getattr(msg, "id", None)
        if not mid:
            return
        now = int(time.time())
        self.sent_ids[int(mid)] = now
        for k in [k for k, v in self.sent_ids.items() if now - v > 48 * 3600]:
            del self.sent_ids[k]
        if len(self.sent_ids) > 2000:
            self.sent_ids = dict(
                sorted(self.sent_ids.items(), key=lambda kv: kv[1])[-2000:])
        self.state["sent_ids"] = {str(k): v for k, v in self.sent_ids.items()}

    def is_ours(self, msg_id, text: str) -> bool:
        """Is this outbound message OURS? id in the sent-id registry
        (reliable, survives footer edits/restarts) OR legacy footer match
        (messages sent before the registry existed)."""
        try:
            if msg_id is not None and int(msg_id) in self.sent_ids:
                return True
        except (TypeError, ValueError):
            pass
        return self.is_bot_own_text(text)

    # ---------- Part J: single payment follow-up scheduler ----------
    def followup_enabled(self) -> bool:
        return _cfg_bool(self.config, "payment_followup", True)

    def _persist_followups(self):
        self.state["followups"] = {
            str(c): f for c, f in self.followup_armed.items()}

    def arm_followup(self, chat_id: int, answer: str) -> None:
        """Card number sent = payment step entered -> ONE short follow-up
        after 10 min. Cancelled by any later customer activity/owner reply.
        Unique id per scheduled action (idempotent replace per chat)."""
        if not self.followup_enabled() or not CARD_RE.search(answer or ""):
            return
        fu = {"id": uuid.uuid4().hex[:12],
              "due": time.time() + FOLLOWUP_DELAY_S,
              "armed_ts": time.time()}
        self.followup_armed[chat_id] = fu
        self._persist_followups()
        WLOG.log("followup_armed", chat_id=chat_id, fid=fu["id"])

    def cancel_followup(self, chat_id: int, reason: str) -> dict | None:
        fu = self.followup_armed.pop(chat_id, None)
        if fu:
            self._persist_followups()
            WLOG.log("followup_cancel", chat_id=chat_id,
                     reason=reason, fid=fu.get("id"))
        return fu

    def effective_system_prompt(self) -> str:
        persona = _cfg_str(self.config, "persona", SYSTEM_PROMPT)
        ins = self.config.get("instructions") or []
        if not ins:
            return persona
        return persona + "\n\nقوانین دائمی که مالک بعدا گفته (حکمشون " \
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
        # Part B: the buffer may hold several consecutive fragments —
        # they are ONE logical turn, not separate requests.
        lines.append("پیام جدید مشتری (اگه چند خطه، چند پیام پشت سر"
                     " همش بوده و یک نیت واحد هست):")
        lines.append(text)
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
        answer = answer + effective_footer(self.config)  # MANDATORY — code
        WLOG.log("reply_send", chat_id=chat_id, answer=answer[:120])
        async with self.send_lock:
            await asyncio.sleep(random.uniform(4, 6))
            sent = False
            sent_msg = None
            for attempt in range(2):
                try:
                    sent_msg = await self.client.send_message(chat_id, answer)
                    sent = True
                    break
                except FloodWaitError as e:
                    WLOG.log("floodwait", chat_id=chat_id, wait=e.seconds)
                    if attempt == 1 or e.seconds > 1800:
                        break
                    await asyncio.sleep(e.seconds + 2)
            # count ONLY confirmed deliveries — an abandoned floodwait retry
            # used to inflate replies_total and eat rate-limit budget anyway
            if sent:
                self.record_send(chat_id)
                self.register_sent(sent_msg)   # Part U: id registry
                self.arm_followup(chat_id, answer)  # Part J: 10-min nudge
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

    # ---------- Part J: follow-up scheduler ----------
    async def followup_loop(self):
        """Fires the single payment follow-up unless the customer did
        anything after arming (new message, receipt/media, owner took
        over) — deterministic, cancel-safe, rate-limited, one shot."""
        while not self.shutting_down:
            now = time.time()
            for chat_id, fu in list(self.followup_armed.items()):
                if self.shutting_down or now < fu.get("due", 0):
                    continue
                last_ts, _media = self.last_incoming.get(chat_id, (0, False))
                if chat_id in self.pending or chat_id in self.pending_texts:
                    self.cancel_followup(chat_id, "new_message")
                elif last_ts > fu.get("armed_ts", 0):
                    self.cancel_followup(chat_id, "new_message_or_receipt")
                elif self.owner_active.get(chat_id, 0) > fu.get("armed_ts", 0):
                    self.cancel_followup(chat_id, "owner_active")
                elif not self.allow(chat_id):
                    self.cancel_followup(chat_id, "rate_limited")
                else:
                    fu = self.cancel_followup(chat_id, "fired") or {}
                    try:
                        async with self.send_lock:
                            text = random.choice(FOLLOWUP_TEXTS) \
                                + effective_footer(self.config)
                            msg = await self.client.send_message(chat_id, text)
                            self.record_send(chat_id)
                            self.register_sent(msg)
                            self.save_state()
                            WLOG.log("followup_sent", chat_id=chat_id,
                                     fid=fu.get("id"))
                    except Exception as e:  # noqa: BLE001
                        WLOG.log("followup_fail", chat_id=chat_id,
                                 err=str(e)[:80])
            await asyncio.sleep(30)

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
                       + effective_footer(self.config))
            msg = await self.client.send_file(
                OWNER_USER_ID, path, caption=caption,
                supports_streaming=False)
            self.register_sent(msg)
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
            text = text + effective_footer(self.config)
        for chat_id in pb["targets"]:
            try:
                await asyncio.sleep(random.uniform(6, 10))
                msg = await self.client.send_message(chat_id, text)
                self.register_sent(msg)
                sent += 1
            except FloodWaitError as e:
                WLOG.log("floodwait", chat_id=chat_id, wait=e.seconds)
                if e.seconds <= 900:
                    await asyncio.sleep(e.seconds + 2)
                    try:
                        msg = await self.client.send_message(chat_id, text)
                        self.register_sent(msg)
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
        self.save_state()
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
            "⚡ مدل: glm-4-plus (تنها مدل سرویس) + حالت تفکر "
            + ("فعال" if _cfg_bool(self.config, "thinking", LLM_THINKING)
               else "غیرفعال"),
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
            msg = await self.client.send_message(
                OWNER_USER_ID, text + effective_footer(self.config))
            self.register_sent(msg)
            self.save_state()
        except Exception as e:  # noqa: BLE001
            WLOG.log("ack_fail", err=str(e)[:80])

    # ---------- v8: send queue (other services -> this client) ----------
    async def _sendq_one(self, path: str) -> None:
        """Send one queued item; delete on success, .failed on hard error.
        FloodWait is honored inline once (long waits give up -> .failed)."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                q = json.load(f)
        except (json.JSONDecodeError, OSError):
            os.replace(path, path + ".bad")
            return
        try:
            chat = q.get("chat") or OWNER_USER_ID
            file_path = str(q.get("file") or "").strip()
            caption = str(q.get("caption") or "").strip()
            text = str(q.get("text") or "").strip()
            if file_path:
                msg = await self.client.send_file(
                    chat, file_path, caption=caption or None,
                    supports_streaming=False)
                self.register_sent(msg)
                self.save_state()   # persist the id registry (Part U)
                WLOG.log("sendq_file", chat=str(chat)[:32],
                         file=file_path[-70:])
            elif text:
                msg = await self.client.send_message(chat, text[:4000])
                self.register_sent(msg)
                self.save_state()   # persist the id registry (Part U)
                WLOG.log("sendq_text", chat=str(chat)[:32])
            else:
                WLOG.log("sendq_skip", reason="empty")
            os.remove(path)
        except FloodWaitError as e:
            if e.seconds > 900:
                WLOG.log("sendq_fail", err=f"floodwait {e.seconds}s")
                os.replace(path, path + ".failed")
            else:  # long floodwait honored inline, one retry after it
                WLOG.log("floodwait", chat=None, wait=e.seconds)
                await asyncio.sleep(e.seconds + 2)
                try:  # noqa: E722  — one inline retry after the wait
                    chat = q.get("chat") or OWNER_USER_ID
                    if str(q.get("file") or "").strip():
                        msg = await self.client.send_file(
                            chat, str(q["file"]),
                            caption=str(q.get("caption") or "") or None,
                            supports_streaming=False)
                    else:
                        msg = await self.client.send_message(
                            chat, str(q.get("text") or "")[:4000])
                    self.register_sent(msg)
                    self.save_state()  # persist the id registry (Part U)
                    os.remove(path)
                    WLOG.log("sendq_file", chat=str(chat)[:32],
                             file="retry-ok")
                except Exception as e2:  # noqa: BLE001
                    WLOG.log("sendq_fail", err=str(e2)[:80])
                    os.replace(path, path + ".failed")
        except Exception as e:  # noqa: BLE001
            WLOG.log("sendq_fail", err=str(e)[:100])
            os.replace(path, path + ".failed")

    async def process_sendq(self):
        """Watchdog step: drain the sendq dir (oldest first)."""
        try:
            names = sorted(n for n in os.listdir(SENDQ_DIR)
                           if n.endswith(".json"))
        except OSError:
            return
        for name in names:
            if self.shutting_down:
                return
            await self._sendq_one(os.path.join(SENDQ_DIR, name))

    # ---------- v8: image request queue (owner command -> agent core) -----
    def queue_image_request(self, prompt: str):
        os.makedirs(IMGREQ_DIR, exist_ok=True)
        req = {"chat_id": OWNER_USER_ID, "prompt": prompt,
               "ts": int(time.time()),
               "src": os.path.basename(W_INSTANCE_DIR) or "main"}
        p = os.path.join(IMGREQ_DIR,
                         f"req-{int(time.time() * 1000)}.json")
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(req, f, ensure_ascii=False)
        os.replace(tmp, p)
        WLOG.log("imgreq_queued", prompt=prompt[:80])

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
                text = text + effective_footer(self.config)
            msg = await self.client.send_message(entity, text)
            self.register_sent(msg)
            self.save_state()
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
            elif action == "image":
                prompt = (a.get("prompt") or "").strip()
                if prompt:
                    self.queue_image_request(prompt)
                    await self.ack("🎨 باشه، تو صف تولید تصویر ثبتش کردم؛ "
                                   "تا یه دقیقه دیگه همین‌جا برات می‌فرستم.")
                else:
                    await self.ack("چی بسازم؟ یه توصیف از تصویری که می‌خوای "
                                   "بگو تا بسازمش 🎨")
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
                        and not self.is_ours(m.id, m.message or ""):
                    self.owner_active[d.id] = m.date.timestamp()
            last = msgs[0]
            if last.out or last.date is None:
                continue
            if last.date.timestamp() < since:
                continue
            text = (last.message or "").strip() or MEDIA_PLACEHOLDER
            if self.is_ours(last.id, text):
                continue
            WLOG.log("catchup_found", chat_id=d.id, text=text[:80])
            self.pending[d.id] = time.time() + 2
            # Part B: aggregate with anything already buffered for this chat
            prev = self.pending_texts.get(d.id, "")
            self.pending_texts[d.id] = \
                text if not prev else (prev + "\n" + text)[:TURN_MAX_CHARS]
            await asyncio.sleep(0.5)

        # owner commands left in Saved Messages during downtime
        # (main watcher only — instance commands arrive as live DMs)
        if W_INSTANCE_DIR:
            return
        try:
            last_sm = int(self.state.get("last_sm_id", 0))
            sm_msgs = await self.client.get_messages(OWNER_USER_ID, limit=5)
            for m in sorted(sm_msgs, key=lambda x: x.id):
                if m.id <= last_sm or not m.out or m.date is None:
                    continue
                if m.date.timestamp() < since:
                    continue
                text = (m.message or "").strip()
                if not text or self.is_ours(m.id, text):
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
            # v8: drain the send queue (other services -> this client)
            if not self.shutting_down:
                await self.process_sendq()
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
        session_string = (_instance_env_value("TELEGRAM_SESSION_STRING")
                          if W_INSTANCE_DIR else get_session_string())
        if not session_string:
            WLOG.log("fatal", err="no session string — login required")
            return 3
        api_id = int(get_env("TELEGRAM_API_ID"))
        api_hash = get_env("TELEGRAM_API_HASH")
        try:
            self.client = TelegramClient(
                StringSession(session_string), api_id, api_hash,
                device_model="Z Watcher", system_version="linux")
            await self.client.connect()
            me = await self.client.get_me()
        except Exception as e:  # noqa: BLE001
            WLOG.log("fatal", err=f"auth failed — {str(e)[:100]}")
            try:
                await self.client.disconnect()
            except Exception:  # noqa: BLE001
                pass
            return 3
        if not me:
            WLOG.log("fatal", err="auth failed — session dead")
            await self.client.disconnect()
            return 3
        WLOG.log("start", me=f"@{me.username}", id=me.id,
                 instance=os.path.basename(W_INSTANCE_DIR) or "main",
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
                # instance mode: DMs FROM the owner are the command channel
                if W_INSTANCE_DIR \
                        and self.config.get("saved_messages_commands", True):
                    cmd_text = (event.message.message or "").strip()
                    if cmd_text and not self.is_ours(event.message.id,
                                                     cmd_text):
                        WLOG.log("owner_command", src="owner_dm",
                                 text=cmd_text[:150])
                        asyncio.create_task(
                            self.handle_owner_command(cmd_text))
                return
            if is_service_user(chat):
                return
            if self.is_blacklisted(chat):
                WLOG.log("blacklisted_skip", chat_id=chat.id,
                         user=getattr(chat, "username", ""))
                return
            text = (event.message.message or "").strip() or MEDIA_PLACEHOLDER
            self.today_incoming += 1
            # Part J: remember the last incoming (for follow-up cancels)
            self.last_incoming[event.chat_id] = (
                time.time(), text == MEDIA_PLACEHOLDER)
            # Part B: consecutive fragments aggregate into ONE logical
            # turn (the old code REPLACED the buffer, so only the last
            # message of a burst was ever answered).
            self.pending[event.chat_id] = time.time() + \
                _rate_limits(self.config)["debounce_s"]
            prev = self.pending_texts.get(event.chat_id, "")
            self.pending_texts[event.chat_id] = \
                text if not prev else (prev + "\n" + text)[:TURN_MAX_CHARS]
            WLOG.log("incoming", chat_id=event.chat_id, text=text[:80])

        @self.client.on(events.NewMessage(outgoing=True))
        async def on_outgoing(event):  # noqa: WPS430
            text = event.message.message or ""
            if self.is_ours(event.message.id, text):
                return  # our own send (sent-id registry / footer fallback)
            # Saved Messages = owner command channel.
            # main watcher: chat with OWNER_USER_ID is his own account's SM;
            # instance: this account's own chat id = its Saved Messages.
            sm_chat_id = me.id if W_INSTANCE_DIR else OWNER_USER_ID
            if event.chat_id == sm_chat_id:
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
            asyncio.create_task(self.followup_loop()),
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
    ap.add_argument("--instance", action="store_true",
                    help="marker: per-account instance launched via "
                         "instances_ctl.sh (W_INSTANCE_DIR env carries the "
                         "instance dir); lets watcher_ctl.sh stop spare "
                         "instance processes")
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
