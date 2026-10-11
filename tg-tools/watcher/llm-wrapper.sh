#!/usr/bin/env python3
"""
llm-wrapper.sh — Drop-in replacement for `z-ai chat` CLI.
Reads OpenRouter (or any OpenAI-compatible API) config from:
  1. ~/my-project/.secrets/llm.env (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL)
  2. ~/.z-ai/config.json (apiKey, baseUrl, model)
  3. Environment variables (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL)

Usage (same as z-ai):
  llm-wrapper.sh chat -p "prompt" -s "system" -o output.json [-t]
"""
import sys
import os
import json
import urllib.request
import urllib.error
import socket
import ssl

HOME = os.path.expanduser("~")
PROJECT_DIR = os.environ.get("PROJECT_DIR", os.path.join(HOME, "my-project"))


def _detect_proxy():
    """Auto-detect proxy: env var > tg.env > scan common ports."""
    proxy = os.environ.get("TELEGRAM_PROXY", "") or os.environ.get("LLM_PROXY", "")
    if proxy:
        return proxy
    # Try reading from tg.env
    tg_env = os.path.join(PROJECT_DIR, ".secrets", "tg.env")
    if os.path.exists(tg_env):
        try:
            with open(tg_env) as f:
                for line in f:
                    if line.strip().startswith("TELEGRAM_PROXY="):
                        return line.split("=", 1)[1].strip().strip("'\"")
        except Exception:
            pass
    # Auto-scan common proxy ports (v2ray/xray/clash)
    for port in [10808, 10809, 7890, 1080, 2080, 8080]:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.3)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                s.close()
                return f"socks5://127.0.0.1:{port}"
            s.close()
        except Exception:
            pass
    return ""

# Load config
API_KEY = ""
BASE_URL = ""
MODEL = ""

# Try llm.env first
llm_env = os.path.join(PROJECT_DIR, ".secrets", "llm.env")
if os.path.exists(llm_env):
    with open(llm_env) as f:
        for line in f:
            line = line.strip()
            if line.startswith("LLM_API_KEY="):
                API_KEY = line.split("=", 1)[1].strip().strip("'\"")
            elif line.startswith("LLM_BASE_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip("'\"")
            elif line.startswith("LLM_MODEL="):
                MODEL = line.split("=", 1)[1].strip().strip("'\"")

# Fallback to z-ai config
if not API_KEY or not BASE_URL:
    zai_cfg = os.path.join(HOME, ".z-ai", "config.json")
    if os.path.exists(zai_cfg):
        try:
            with open(zai_cfg) as f:
                cfg = json.load(f)
            API_KEY = API_KEY or cfg.get("apiKey", "")
            BASE_URL = BASE_URL or cfg.get("baseUrl", "")
            MODEL = MODEL or cfg.get("model", "")
        except Exception:
            pass

# Fallback to env vars
API_KEY = API_KEY or os.environ.get("LLM_API_KEY", "")
BASE_URL = BASE_URL or os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1")
MODEL = MODEL or os.environ.get("LLM_MODEL", "deepseek/deepseek-chat")

if not API_KEY:
    print("Error: No API key found. Set LLM_API_KEY in ~/my-project/.secrets/llm.env", file=sys.stderr)
    sys.exit(1)

def parse_args(argv):
    """Parse: chat -p PROMPT -s SYSTEM -o OUTPUT [-t]"""
    prompt = ""
    system = ""
    output_file = ""
    thinking = False
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "chat":
            i += 1
            continue
        elif a == "-p":
            i += 1
            prompt = argv[i] if i < len(argv) else ""
        elif a == "-s":
            i += 1
            system = argv[i] if i < len(argv) else ""
        elif a == "-o":
            i += 1
            output_file = argv[i] if i < len(argv) else ""
        elif a == "-t":
            thinking = True
        i += 1
    return prompt, system, output_file, thinking

def call_llm(prompt, system, thinking=False):
    """Call OpenAI-compatible API and return response in OpenAI format."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    
    url = BASE_URL.rstrip("/") + "/chat/completions"
    body = {
        "model": MODEL,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 2000,
    }
    
    data = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
        "HTTP-Referer": "https://github.com/CiaNetIR/agent",
        "X-Title": "CiaNet Watcher",
    }
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    
    # Auto-detect and use proxy (needed for Iran/filtered networks)
    proxy = _detect_proxy()
    if proxy:
        try:
            import socks
            proxy_handler = None
            if proxy.startswith("socks5://"):
                host, port = proxy[9:].split(":")
                socks.set_default_proxy(socks.SOCKS5, host, int(port))
                socket.socket = socks.socksocket
            elif proxy.startswith("http://"):
                proxy_handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy})
            if proxy_handler:
                opener = urllib.request.build_opener(proxy_handler)
                urllib.request.install_opener(opener)
            print(f"✓ using proxy: {proxy}", file=sys.stderr)
        except ImportError:
            print("⚠ PySocks not installed — pip install PySocks", file=sys.stderr)
        except Exception as e:
            print(f"⚠ proxy setup failed: {e}", file=sys.stderr)
    
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=90, context=ctx) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:500]
        print(f"HTTP {e.code}: {err_body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def main():
    prompt, system, output_file, thinking = parse_args(sys.argv)
    if not prompt:
        print("Error: no prompt (-p)", file=sys.stderr)
        sys.exit(1)
    
    result = call_llm(prompt, system, thinking)
    
    if output_file:
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"✓ Response saved to {output_file}", file=sys.stderr)
    else:
        # Print to stdout (like z-ai does without -o)
        content = (result.get("choices") or [{}])[0].get("message", {}).get("content", "")
        print(content)

if __name__ == "__main__":
    main()
