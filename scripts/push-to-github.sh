#!/usr/bin/env bash
# ساخت ریپوی خصوصی «agent» روی گیت‌هاب + پوش کامل آینه /home/z/agent-repo
# استفاده:  ./push-to-github.sh ghp_YOUR_TOKEN    (یا: GITHUB_TOKEN=ghp_... ./push-to-github.sh)
set -euo pipefail

TOKEN="${1:-${GITHUB_TOKEN:-}}"
MIRROR_DIR="/home/z/agent-repo"
REPO_NAME="agent"
REPO_DESC="دستیار هوشمند سی‌آنِت — پنل مدیریت، ایجنت تلگرام، اسکرپر، ووکامرس، فاکتور خودکار و گزارش روزانه"

if [[ -z "$TOKEN" ]]; then
  echo "❌ توکن ندادید. استفاده: $0 ghp_YOUR_TOKEN" >&2
  exit 1
fi

# نبود توکن در خروجی/لاگ
trap 'echo "❌ خطا در مرحله: ${BASH_COMMAND}"' ERR

echo "۱) تشخیص اکانت گیت‌هاب از روی توکن..."
USER_JSON="$(curl -sS --fail -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" https://api.github.com/user)"
GH_USER="$(printf '%s' "$USER_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["login"])')"
echo "   ✅ اکانت: $GH_USER"

echo "۲) ساخت ریپوی خصوصی «$REPO_NAME» (اگر از قبل باشد، نادیده گرفته می‌شود)..."
CREATE_CODE="$(curl -sS -o /tmp/gh_create.json -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user/repos \
  -d "{\"name\":\"$REPO_NAME\",\"private\":true,\"description\":\"$REPO_DESC\",\"has_issues\":true,\"has_wiki\":false}")"
if [[ "$CREATE_CODE" == "201" ]]; then
  echo "   ✅ ریپو ساخته شد: https://github.com/$GH_USER/$REPO_NAME"
elif [[ "$CREATE_CODE" == "422" ]]; then
  echo "   ℹ️  ریپو از قبل وجود داشت — ادامه با پوش."
else
  echo "   ❌ ساخت ریپو ناموفق (HTTP $CREATE_CODE):" >&2
  cat /tmp/gh_create.json >&2
  exit 1
fi
rm -f /tmp/gh_create.json

echo "۳) تنظیم ریموت (بدون ذخیره‌ی توکن در git config)..."
cd "$MIRROR_DIR"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$GH_USER/$REPO_NAME.git"

echo "۴) پوش کامل (۵ کامیت: کل سیستم + پنل + ایجنت + واتچر)..."
git push "https://x-access-token:${TOKEN}@github.com/$GH_USER/$REPO_NAME.git" main:main
echo "   ✅ پوش انجام شد."

echo "۵) راستی‌آزمایی از سرور گیت‌هاب..."
LS_OUT="$(git ls-remote "https://x-access-token:${TOKEN}@github.com/$GH_USER/$REPO_NAME.git" refs/heads/main)"
LOCAL_HEAD="$(git rev-parse main)"
REMOTE_HEAD="$(printf '%s' "$LS_OUT" | awk '{print $1}')"
if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
  echo "   ✅ سرور گیت‌هاب روی همان کامیت محلی است: $LOCAL_HEAD"
else
  echo "   ❌ ناهم‌خوانی! محلی=$LOCAL_HEAD ریموت=$REMOTE_HEAD" >&2
  exit 1
fi

echo
echo "🎉 تمام شد: https://github.com/$GH_USER/$REPO_NAME (خصوصی)"
echo "   توکن هیچ‌جای دیسک ذخیره نشده (فقط در حافظه‌ی همین اسکریپت بود)."
