---
Task ID: T4
Agent: general-purpose (live panel test)
Task: PHASE 3 — run the REAL CiaNet v2.14.2 web panel live (uvicorn, port 8877, repo copy at /tmp/t4/repo) and test the security matrix end-to-end per rules §13: admin/user login + rate limits, CSRF double-submit, ownership 403, pagination clamps, XFF trusted-proxy handling, error sanitation, docs state.
Work Log:

## Setup
- Read CIANET_RULES_AND_POLICIES.md §13 (all sub-sections 13.1–13.12) + worklog.md 0-PLAN, P1-5 (web_panel fix report: cookie names, 11 CSRF-protected user endpoints, rate-limit machinery, clamps), P2-1/P2-6/P2-10 refs and 2-ORCH (hmac.compare_digest CSRF, is_owner_bypass in ownership gates, payment-create CSRF).
- `cp -r /home/z/cianet-review /tmp/t4/repo` (work on copy only).
- Deps into sandbox venv (/home/z/.venv, py3.12): fastapi/uvicorn/multipart/telethon/argon2-cffi/cryptography already present; installed passlib + python_socks. NOTE: passlib's bcrypt backend is broken in this sandbox (bcrypt 4.x `__about__` incompat → ValueError; `_verify_password` would return False for correct bcrypt passwords) → used the documented `sha256:` fallback hash format as instructed: `PANEL_ADMIN_PASS_HASH=sha256:724936cd9b665b34b178904d938970b9fffede7f6fcbae3e0f61b87170c06feb` (sha256 of `TestPass123!`).
- Env for launch: `PANEL_ADMIN_USER=testadmin PANEL_ADMIN_PASS_HASH=<sha256:…> API_ID=1 API_HASH=dummy ADMIN_BOT_TOKEN=1:x ADMIN_ID=1` — verified `import web_panel` is side-effect-safe (lazy `_main()`, no network; import runs schema migrations only). `ADMIN_ID=1` chosen so seeded users 1001/2002 are NOT owner-bypassed (is_owner_bypass checks ADMIN_ID/OWNER_IDS).
- DB seeding (sqlite3 on /tmp/t4/repo/saas.db after `main.init_db()`): users 1001/alice + 2002/bob; licenses `TESTLIC1001`/`TESTLIC2002` (license_type=account, is_active=1, used_count=1); subscriptions linking license_id→user_id (status active); config.json with `alice_acc`(owner_user_id=1001) + `bob_acc`(owner_user_id=2002).
- Sandbox quirk: plain `nohup … &` background processes are reaped between shell invocations → wrote a double-fork daemonizer (/tmp/t4/daemon.py, setsid+fork+execve) so uvicorn survives; log /tmp/t4/panel.log. Server restarted (allowed by task) to clear in-memory login blocks where needed.
- Cookie quirk: all cookies set with `Secure` (per §13.5) → curl's cookie jar will not replay them over plain http://127.0.0.1:8877 → extracted values from jar and sent explicit `Cookie:` headers (flags verified from raw Set-Cookie lines instead).
- All flows via curl with `-c` cookie jar; every response (status+body+headers) captured under /tmp/t4/resp/.

## Per-test results
| # | Test | Expectation | Result | Evidence |
|---|------|-------------|--------|----------|
| 1a | Admin login, wrong password | 401 | ✅ PASS | 401 `{"detail":"Invalid credentials"}` |
| 1b | 5 wrong → 6th attempt with CORRECT password | 429 | ✅ PASS | 5×401 then 429 `Too many failed attempts. Try again in 15 min.` |
| 1c | Restart → correct login | 200 + both cookies w/ flags | ✅ PASS | 200 `{"ok":true,"user":{…,"role":"OWNER"}}`; `cianet_panel_session=…; HttpOnly; Max-Age=28800; SameSite=lax; Secure`; `cianet_csrf_token=…` (NO HttpOnly) `Max-Age=28800; SameSite=lax; Secure` |
| 2 | Admin CSRF matrix (PATCH /api/settings + POST /api/tools/api-creds/rotate) | no header→403; correct→not-403; wrong→403 | ✅ PASS | no header→403 `CSRF token invalid — refresh the page`; no csrf cookie (session only)→403 `CSRF token missing — refresh the page` (§13.3); header==cookie→**200** `{"ok":true,…}`; wrong header→403; rotate: no header→403, correct header→400 pool-missing (not 403) |
| 3 | GET endpoints, session only, no CSRF | 200 | ✅ PASS | GET /api/analytics/overview→200 (real JSON stats); GET /api/users→200 |
| 4 | User license login (seeded TESTLIC1001) | 200 + user cookies | ✅ PASS | 200 `{"ok":true,"user_id":1001}`; `cianet_user_session` HttpOnly/SameSite=lax/Secure/Max-Age=86400 + `cianet_user_csrf_token` NOT-HttpOnly/SameSite=lax/Secure/86400 |
| 5 | User CSRF matrix | no header→403; correct→not-403; DELETE+header→not-403 | ✅ PASS | POST /api/user/auto-renew no header→403 invalid; correct header→200 `{"ok":true,"auto_renew_enabled":true,…}`; DELETE /api/user/scheduled-messages/999 + header→200 `{"ok":false}`; DELETE wrong header→403 |
| 6 | User login rate limit (same IP, no XFF) | 5 wrong → 6th valid → 429 | ✅ PASS | 5×404 (`چنین لایسنسی وجود ندارد`) → 6th with VALID code → 429 |
| 7 | Ownership 403 (alice → bob_acc) | 403 «این اکانت متعلق به شما نیست»; unknown tag 404 | ✅ PASS | foreign tag→403 `این اکانت متعلق به شما نیست`; unknown tag→404 `اکانت پیدا نشد`; control own tag→200 `{"ok":true,"id":1}`; auto-replies foreign tag→403 too |
| 8 | Pagination clamp | 200, page_size clamped, no 500 | ✅ PASS | page_size=99999→200 echoed `page_size=200`; page_size=0→1; -5→1; page=99999999999→200 empty items |
| 9 | XFF handling (default PANEL_TRUSTED_PROXIES=127.0.0.1,::1; client host 127.0.0.1=trusted) | _get_client_ip returns XFF value; per-IP limits | ✅ PASS | 5 wrong with 5 DIFFERENT XFFs (9.9.9.1–5) → 6th VALID code + fresh XFF 9.9.9.6 → **200** (no global lockout ⇒ XFF honored); 5 wrong with SAME XFF 8.8.8.8 → 6th valid → **429** (per-IP lockout w/ repeated XFF); multi-hop XFF `1.2.3.4, 8.8.4.4` → 200 (rightmost non-trusted hop used, 8.8.8.8-block not hit); direct 127.0.0.1 still 429 from T6 block (IP isolation) |
| 10 | Error sanitation | no str(e)/exception classes in ANY response | ✅ PASS | malformed JSON /api/auth/login→422 (standard pydantic, no internals); malformed JSON /api/user/scheduled-messages (raw request.json())→**500 sanitized**: `{"detail":"Internal server error","error_id":"0a83248f214396bf","message":"خطای داخلی سرور — …"}` with server-log correlation `❌ [web_panel][0a83248f214396bf] … JSONDecodeError: …`; grep of ALL captured bodies for Traceback/sqlite3./OperationalError/KeyError/ValueError/TypeError/Exception/file paths/line N → **0 matches** |
| 11 | /api/docs state | §13.8: disabled when PANEL_DOCS_ENABLED=0 | ⚠️ DEVIATION | Default: GET /api/docs→**200**, /api/redoc→**200**, /openapi.json→**200 (64 paths)** — docs fully OPEN. Relaunched with `PANEL_DOCS_ENABLED=0`: /api/docs→**200**, /openapi.json→**200** — env var has NO effect anywhere in the codebase (`rg PANEL_DOCS_ENABLED` = 0 hits). §13.8's documented control (PATCH-4 WP-MED-10) is NOT implemented in this code. Evidence: statuses above; panel.log `GET /openapi.json 200 OK` after restart with env set. |
| + | §13.3 no-cookie variants (extra) | 401 | ✅ PASS | PATCH /api/settings no cookies→401 `Unauthorized — login required`; POST /api/user/auto-renew no cookies→401 `Unauthorized — user login required`; GET /api/users no cookie→401 |

Non-blocking observations (not matrix failures):
1. POST /api/user/scheduled-messages defines a local pydantic model `SchedMsgReq` (tag/chat_id/text/scheduled_at) but never parses the body with it — `req = await request.json()` feeds raw dict to main.create_scheduled_message, which rejects bad input via `{"error":"invalid_chat_id"}` with **HTTP 200** (e.g. chat_id="abc"). Rejection still happens + no leak, but the dead model + 200-on-validation-error is a consistency wart (also makes FastAPI docs show no body schema for these endpoints).
2. Rate-limit window divergence (already flagged by P1-5): §13.4 documents "5 failed/15 min" but code uses 5-minute failure window (`_LOGIN_FAIL_WINDOW=300`) + 15-min block — verified live (429 message says 15 min).
3. passlib/bcrypt backend broken under sandbox bcrypt 4.x (ValueError in `_load_backend_mixin`) — `_verify_password`'s try/except fails closed (returns False). Sandbox-env issue, not a code bug; sha256: path verified live incl. constant-time compare.
4. All cookies are `Secure=True` unconditionally (§13.5 says "production via nginx") — over plain HTTP the browser/curl would refuse to replay them; fine behind TLS-terminating nginx, worth noting for local/dev deployments.
- Server killed after tests (`kill` daemon pid; port 8877 free; `ps` confirms no uvicorn remains). Repo copy at /tmp/t4/repo retains seeded saas.db/bot_data.db/config.json for any follow-up.

Stage Summary:
- Matrix: **12/12 test groups executed; 11 PASS, 1 DEVIATION** (T11).
- All §13.1–13.7, §13.9–§13.11 behaviors verified LIVE end-to-end: admin+user auth, fail-closed CSRF double-submit (401/403-missing/403-invalid semantics exact), 5-fail→15-min login rate limits on BOTH login endpoints, cross-tenant ownership 403/404 gates, pagination clamps [1,200], trusted-proxy rightmost-hop XFF with per-IP rate-limit isolation, global exception handler with error_id correlation and zero exception leaks across every captured response.
- FAILURE/DEVIATION (T11): `/api/docs`, `/api/redoc`, `/openapi.json` are served unconditionally (FastAPI `docs_url="/api/docs"`, `redoc_url="/api/redoc"` at web_panel.py:424-430); `PANEL_DOCS_ENABLED` does not exist in the codebase → rules §13.8 ("disabled when PANEL_DOCS_ENABLED=0", claimed applied as PATCH-4 WP-MED-10) is NOT implemented. 64 API paths + schemas exposed to unauthenticated users. Recommended fix: `docs_url=redoc_url=None if os.environ.get("PANEL_DOCS_ENABLED","0")!="1" else "/api/docs"` (default-closed) or honor the env at app construction. Severity: spec-compliance / information-disclosure (LOW-MED).
- No code changes made by this task (test-only; repo copy only).
---
