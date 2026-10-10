#!/home/z/.venv/bin/python
# -*- coding: utf-8 -*-
"""API monitor daemon — STAR VPN / CiaNet (Task 36-e)

Every 60s: heartbeat → state file /home/z/agent-files/api-monitor-state.json
Every 5 min: sha-fingerprint of provider config + SDK files → alert on change
Every 30 min: health ping of the z-ai provider → alert on down / bad creds

Alerts are delivered by writing JSON files into the watcher sendq dir
(/home/z/tg-tools/watcher/sendq/) — NEVER by building a second Telethon
client (golden rule: one session = one client; the session belongs to
the watcher process).

Secret policy: config VALUES (apiKey/token/chatId/userId) are never
logged or alerted — only sha8 prefixes, labels and Tehran timestamps.
"""
import json
import hashlib
import os
import time
import urllib.request
from datetime import datetime, timezone, timedelta

# ── paths & constants ──────────────────────────────────────────────────
STATE_PATH = "/home/z/agent-files/api-monitor-state.json"
SENDQ_DIR = "/home/z/tg-tools/watcher/sendq"
COOLDOWN_PATH = "/home/z/agent-files/llm-cooldown.json"
MAIN_CFG = "/etc/.z-ai-config"

PARTS = [
    ("zai_config", "کانفیگ اصلی",
     "/etc/.z-ai-config"),
    ("zai_backup", "کانفیگ پشتیبان",
     "/home/z/my-project/.secrets/z-ai-config.json"),
    ("sdk_pkg", "پکیج SDK",
     "/home/z/my-project/node_modules/z-ai-web-dev-sdk/package.json"),
    ("sdk_index", "هستهٔ SDK",
     "/home/z/my-project/node_modules/z-ai-web-dev-sdk/dist/index.js"),
    ("sdk_cli", "CLI SDK",
     "/home/z/my-project/node_modules/z-ai-web-dev-sdk/dist/cli.js"),
]

TEH = timezone(timedelta(hours=3, minutes=30), "Asia/Tehran")

TICK_SECONDS = 60
FINGERPRINT_EVERY_TICKS = 5          # 5 × 60s = every 5 minutes
PING_EVERY_TICKS = 30                # 30 × 60s = every 30 minutes
CHANGE_ALERT_THROTTLE_MS = 60 * 60 * 1000        # max 1 fingerprint alert / hour
AUTH_ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000      # max 1 auth alert / 6 hours
FAILS_BEFORE_DOWN = 3
PING_TIMEOUT_S = 45

# in-memory alert throttles (survive the whole daemon lifetime; a restart
# at worst re-arms them — fingerprint state itself lives in the state file)
_last_change_alert_ms = 0
_last_auth_alert_ms = 0


# ── small helpers ──────────────────────────────────────────────────────
def log(msg: str) -> None:
    print(f"[{datetime.now(TEH).strftime('%H:%M:%S')}] {msg}", flush=True)


def now_ms() -> int:
    return int(time.time() * 1000)


_FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def fa_time() -> str:
    """Tehran HH:MM with Persian digits (for alert texts)."""
    return datetime.now(TEH).strftime("%H:%M").translate(_FA_DIGITS)


def atomic_write(path: str, data: bytes) -> None:
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            st = json.load(f)
        return st if isinstance(st, dict) else None
    except (OSError, ValueError):
        return None


def save_state(st: dict) -> None:
    atomic_write(STATE_PATH,
                 json.dumps(st, ensure_ascii=False).encode("utf-8"))


def normalize_state(st: dict) -> None:
    """Guarantee the EXACT state schema (panel reads this file)."""
    st.setdefault("aliveAt", 0)
    st.setdefault("startedAt", now_ms())
    st.setdefault("activated", False)
    st.setdefault("fingerprint", "")
    st.setdefault("fingerprintAt", 0)
    st.setdefault("parts", {})
    st.setdefault("lastPingAt", 0)
    st.setdefault("lastPingOk", False)
    st.setdefault("lastPingStatus", "never")
    st.setdefault("failCount", 0)
    st.setdefault("alertedDown", False)


def sha_file(path: str) -> str:
    """sha256 hex of raw bytes; missing/empty file → sha256 of b''."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        data = b""
    return hashlib.sha256(data).hexdigest()


def compute_fingerprint():
    parts = {key: sha_file(path)[:8] for key, _label, path in PARTS}
    joined = "\n".join(f"{key}={parts[key]}" for key, _l, _p in PARTS)
    overall = hashlib.sha256(joined.encode("utf-8")).hexdigest()
    return overall, parts


def send_alert(text: str) -> None:
    """Queue one Telegram alert via the watcher sendq (atomic, no retry
    logic — if the watcher is down the file waits until it drains)."""
    os.makedirs(SENDQ_DIR, exist_ok=True)
    ms = int(time.time() * 1000)
    while True:
        path = os.path.join(SENDQ_DIR, f"sq-{ms}-mon.json")
        if not os.path.exists(path):
            break
        ms += 1  # never overwrite a same-millisecond sibling
    payload = json.dumps({"chat": "me", "text": text},
                         ensure_ascii=False).encode("utf-8")
    atomic_write(path, payload)
    log(f"alert queued → sendq ({os.path.basename(path)}, {len(text)} chars)")


# ── b) fingerprint step ────────────────────────────────────────────────
def do_fingerprint(st: dict) -> None:
    global _last_change_alert_ms
    overall, parts = compute_fingerprint()
    prev_parts = st.get("parts") or {}
    prev_fp = st.get("fingerprint") or ""

    if st.get("activated") is not True or not prev_parts:
        # first run (or state lost) → store baseline, activate once ever
        st["fingerprint"] = overall
        st["parts"] = parts
        st["fingerprintAt"] = now_ms()
        st["activated"] = True
        send_alert(
            "✅ مانیتور API فعال شد\n"
            "از این پس هر تغییر در آدرس/کلید/نسخهٔ provider هوش مصنوعی و هر قطعی، "
            "همین‌جا به سیو مسیج تو اطلاع داده می‌شود.\n"
            f"ساعت: {fa_time()}"
        )
        log(f"fingerprint baseline stored: {overall[:8]} "
            f"({'+'.join(parts[k] for k, _l, _p in PARTS)})")
        return

    if overall == prev_fp:
        st["fingerprintAt"] = now_ms()
        log(f"fingerprint unchanged: {overall[:8]}")
        return

    # ── change detected: list exactly which parts changed ──
    lines = []
    for key, label, _path in PARTS:
        old, new = prev_parts.get(key, "????????"), parts[key]
        lines.append(f"• {label}: {old} → {new}" if old != new
                     else f"• {label}: بدون تغییر")
    text = ("⚠️ تغییر در API تشخیص داده شد\n" + "\n".join(lines) +
            f"\nساعت: {fa_time()} — اگر خودت تغییری ندادی فوراً بررسی کن.")
    if now_ms() - _last_change_alert_ms >= CHANGE_ALERT_THROTTLE_MS:
        _last_change_alert_ms = now_ms()
        send_alert(text)
    else:
        log("fingerprint change detected but alert throttled (max 1/hour)")
    st["fingerprint"] = overall
    st["parts"] = parts
    st["fingerprintAt"] = now_ms()
    log(f"fingerprint CHANGED: {prev_fp[:8]} → {overall[:8]}")


# ── c) health ping step ────────────────────────────────────────────────
def _bump_fail(st: dict) -> None:
    st["failCount"] = int(st.get("failCount") or 0) + 1
    if st["failCount"] >= FAILS_BEFORE_DOWN and st.get("alertedDown") is not True:
        st["alertedDown"] = True
        send_alert("🔴 API هوش مصنوعی از دسترس خارج شد "
                   "(۳ سلامت‌سنجی ناموفق پشت‌سرهم)\n"
                   f"ساعت: {fa_time()}")


def do_ping(st: dict) -> None:
    global _last_auth_alert_ms
    now = now_ms()
    st["lastPingAt"] = now

    # shared 429-shield cooldown → don't waste provider rate budget
    try:
        with open(COOLDOWN_PATH, "r", encoding="utf-8") as f:
            cd = json.load(f)
        if float(cd.get("until") or 0) > time.time() * 1000:
            st["lastPingOk"] = True
            st["lastPingStatus"] = "cooldown"
            log("health ping skipped — shared 429 cooldown active (provider alive)")
            return
    except (OSError, ValueError):
        pass  # no/invalid cooldown file → do the real ping

    # read provider config (values never printed)
    try:
        with open(MAIN_CFG, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        base = str(cfg.get("baseUrl") or "").rstrip("/")
        if not base:
            raise ValueError("baseUrl empty")
    except Exception as e:
        st["lastPingOk"] = False
        st["lastPingStatus"] = "config-read-error"
        _bump_fail(st)
        log(f"health ping failed — provider config unreadable "
            f"({type(e).__name__})")
        return

    body = json.dumps({
        "messages": [{"role": "user", "content": "ping"}],
        "thinking": {"type": "disabled"},
    }).encode("utf-8")
    req = urllib.request.Request(
        base + "/chat/completions", data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + str(cfg.get("apiKey") or ""),
            "X-Z-AI-From": "Z",
            "X-Chat-Id": str(cfg.get("chatId") or ""),
            "X-User-Id": str(cfg.get("userId") or ""),
            "X-Token": str(cfg.get("token") or ""),
        })
    t0 = time.time()
    status = None
    try:
        with urllib.request.urlopen(req, timeout=PING_TIMEOUT_S) as r:
            status = int(r.status)
    except Exception as e:                       # HTTPError carries .code
        status = getattr(e, "code", None)
        if status is None:
            if isinstance(e, TimeoutError) or "timed out" in str(e).lower():
                status = "timeout"
            else:
                status = type(e).__name__[:24]
    took = int((time.time() - t0) * 1000)

    if status == 200:
        st["lastPingOk"] = True
        st["lastPingStatus"] = 200
        st["failCount"] = 0
        if st.get("alertedDown") is True:
            st["alertedDown"] = False
            send_alert(f"✅ API دوباره سالم شد\nساعت: {fa_time()}")
        log(f"health ping OK (200, {took}ms)")
    elif status in (401, 403):
        st["lastPingOk"] = False
        st["lastPingStatus"] = status
        _bump_fail(st)
        if now_ms() - _last_auth_alert_ms >= AUTH_ALERT_THROTTLE_MS:
            _last_auth_alert_ms = now_ms()
            send_alert("🚨 اعتبارنامهٔ API رد شد (401/403) — احتمالاً کلید عوض شده؛ "
                       "فایل /etc/.z-ai-config را با نسخهٔ پشتیبان مقایسه کن.\n"
                       f"ساعت: {fa_time()}")
        log(f"health ping REJECTED (HTTP {status}) — credentials refused")
    elif status == 429:
        st["lastPingOk"] = True     # rate-limited ≠ down
        st["lastPingStatus"] = 429
        log(f"health ping rate-limited (429, {took}ms) — treated as alive")
    else:
        st["lastPingOk"] = False
        st["lastPingStatus"] = status
        _bump_fail(st)
        log(f"health ping FAILED ({status}, {took}ms) "
            f"failCount={st.get('failCount')}")


# ── a) one tick = heartbeat + optional fingerprint/ping ────────────────
def tick(st: dict, n: int) -> None:
    st["aliveAt"] = now_ms()                                   # heartbeat
    if st.get("activated") is not True or n % FINGERPRINT_EVERY_TICKS == 0:
        do_fingerprint(st)                                    # every 5 min
    if n % PING_EVERY_TICKS == 1:                              # every 30 min
        do_ping(st)                                           # (incl. tick 1)
    save_state(st)
    log(f"tick {n} — alive (fp={str(st.get('fingerprint'))[:8]})")


def main() -> None:
    log("API monitor starting (60s ticks, fp/5min, ping/30min)")
    st = load_state()
    if st is None:
        st = {"startedAt": now_ms(), "activated": False}
        log("no previous state — first run (activation alert due)")
    else:
        log(f"state loaded (startedAt={st.get('startedAt')}, "
            f"activated={st.get('activated')})")
    normalize_state(st)
    n = 0
    while True:
        n += 1
        try:
            tick(st, n)
        except Exception as e:   # one bad tick must never kill the daemon
            log(f"tick {n} error (ignored): {type(e).__name__}: "
                f"{str(e)[:120]}")
        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    main()
