Task ID: T8
Agent: general-purpose (rules compliance)
Task: PHASE 3 — verify the v2.14.2 fix operation did NOT violate CIANET_RULES_AND_POLICIES.md (§2-§7 RBAC, §4 OWNER restrictions, §13 web panel, §18.5) — especially "OWNER never gets blocked". READ-ONLY on /home/z/cianet-review; harness under /tmp/t8/ (repo copy at /tmp/t8/repo, stub-telethon import approach like other testers).

Work Log:
- Read CIANET_RULES_AND_POLICIES.md fully (1,214 lines): §2 (roles/get_role/is_owner_bypass), §3 (main owner), §4.1-4.14 (OWNER restrictions incl. §4.4 rate-limit, §4.5 CSRF, §4.8 login_guard), §5.1-5.8 (per-operation RBAC), §6 (SECURITY_ROUTES/_TAG_PREFIXES), §7 (capability grants), §13.1-13.12 (web panel), §18.5, §19, §20.1-20.16.
- Read worklog.md fully: 0-PLAN, P1-1..P1-10, P2-1..P2-10, 2-ORCH. Auth-path fixes under test: BUG-2d + P2-1 residual (main.py ownership gates), BUG-2w + 2-ORCH §20.1 (web ownership gates), BUG-34 (role_add gate), BUG-11w a/b (require_user_csrf new / require_csrf fail-closed), BUG-12w (login rate limit), BUG-27w (session sweep), CSRF header wiring (P1-6/P1-7 frontend), 2-ORCH payment-create CSRF.
- Copied repo to /tmp/t8/repo; verified baseline: HEAD = f563524 (v2.14.1), whole operation is the uncommitted working tree → `git diff HEAD` = the full operation diff (main.py 1,059-line diff, web_panel.py 582-line diff).
- §4.4: grepped web_panel.py for _record_login_failure/_login_blocks/_check_login_rate_limit/_login_failures/_maybe_sweep_sessions/_sweep_expired_sessions → referenced ONLY at definitions (478-568) and inside the two login handlers (auth_login 571-592, user_license_login 1639-1687). No other endpoint.
- §4.5/§13.2 static trace: read require_csrf (303-327), require_user_csrf (254-284), both login handlers, app.js getCsrfToken/api(), u/app.js getUserCsrfToken/apiCall, login.html, authGuard/requireAuth. Confirmed: cookies set IN the login response; auth guards are GET-only; all mutations post-login; api()/apiCall attach X-CSRF-Token on non-GET.
- §4.8: read _toggle_login_guard (main.py 8688-8735); compared against v2.14.1-stable (byte-identical), v2.14.0-stable, v2.13.3-stable; grep of `git diff HEAD` for SECURITY_ROUTES/authorize_sensitive_account_action/_toggle_login_guard/_authorize_security/is_owner_bypass/get_role/OWNER_IDS/_security_main_owner_id → ZERO diff lines (untouched by our fixes).
- §4.9-4.14/§5: read create_scheduled_message (2590-2624), create_auto_reply (2648-2672), web gates (web_panel 2528-2554, 2571-2586), role_add gate (20313-20333), _role/get_role (10948/1736-1770); grep of full diff for removed/added role-condition lines; confirmed zero diff-lines in wallet_credit/wallet_debit/delete_user_completely/_dedicated_bot_toggle/_enable_account/_delete_account/audit/set_setting.
- §13.2 matrix: built /tmp/t8/matrix.py — imports REAL web_panel.py (stub telethon from /tmp/p14stubs, real main.py, SELFBOT_DATA_DIR=/tmp/t8/data) → FastAPI app.routes introspection: 74 API routes; auth resolved from Depends + in-body require_auth/require_user_auth + transitive (_get_live_client, _valid_session, csrf-deps-validate-session). 97/97 assertions PASS.
- §13.5: AST introspection of set_cookie calls in both login handlers + TTL constants (28,800s/86,400s). All flags match.
- §18.5: extracted account_belongs_to from v2.14.1-stable and current tree → md5-identical (a7e9f10b…, 41 lines); diff shows only NEW CALLERS added, zero removals/changes.
- Item 8: full `git diff HEAD --unified=0` audit — every `+` line with reject semantics classified; every `-` line checked for removed bypasses (none).
- Functional harness /tmp/t8/functional.py (real imported main.py + web_panel.py, temp DB/config, OWNER_IDS=1,999 multi-owner): 29/29 PASS — is_owner_bypass/get_role multi-owner, both main.py gates + web-gate predicate (own OK / foreign rejected / ADMIN_ID bypass / OWNER_IDS-member bypass / nonexistent fail-closed), require_csrf + require_user_csrf 401/403/403/pass semantics, login rate-limit 5→900s block per-IP only, role_add AST condition.
- No commits/pushes; source tree untouched; all artifacts in /tmp/t8/ (+ copies of scripts in /home/z/my-project/tmp-t8/).

Stage Summary — compliance matrix:

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | §4.4 rate-limit ONLY on login endpoints | ✅ PASS | helpers referenced only in /api/auth/login + /api/user/login; sweep (BUG-27w) also login-triggered only, removes expired entries only; no other endpoint limited |
| 2 | §4.5+§13.2 CSRF must not lock out legit OWNER | ✅ PASS | login response sets cianet_panel_session (HttpOnly) AND cianet_csrf_token (non-HttpOnly) together, BEFORE any mutation is possible; require_csrf compares X-CSRF-Token vs stored csrf (hmac.compare_digest); app.js api() sends header on all non-GET; login POST exempt; authGuard/requireAuth are GET-only; no mutation before login anywhere. Owner passes (functional test). Legacy-session 403 is documented §13.3 force-re-login; in-memory sessions don't survive deploys (§18.2) |
| 3 | §4.8 login_guard OWNER bypass unchanged by fixes | ✅ UNTOUCHED (with pre-existing flag) | git diff HEAD: zero hunks in _toggle_login_guard/SECURITY_ROUTES/authorize_sensitive_account_action/_authorize_security/is_owner_bypass/get_role; function byte-identical to v2.14.1-stable. PRE-EXISTING (not ours): v2.14.1 commit reverted v2.14.0's OWNER_IDS-aware gate back to v2.12.31 DoS logic → main owner IS blocked on other users' accounts (contradicts §4.8 text) and authorize's owner branch is single-ID (not is_owner_bypass, contradicts §4.6/§2.3). Web panel POST /api/accounts/{tag}/login_guard still gives panel OWNER unrestricted toggle (documented recovery path). Flagged for orchestrator — existed before this operation |
| 4 | §4.9-4.14 + §5 spot checks | ✅ PASS | create_scheduled_message/create_auto_reply (main.py + web) all use `account_belongs_to(...) or is_owner_bypass(...)` — §20.1 GOOD pattern; runtime-proven for ADMIN_ID and OWNER_IDS member; role_add gate uses `self._role(sender) != ROLE_OWNER` (get_role → ADMIN_ID + OWNER_IDS multi-owner safe) = documented §5.2 OWNER-only gate; zero diff-lines in wallet/delete/audit/settings/dedicated-bot paths |
| 5 | §13.2 endpoint matrix | ✅ PASS 97/97 | full table below: every /api/user/* POST/PATCH/DELETE except login/logout has require_user_csrf (11 + payment-creates); every admin mutation has require_csrf (18); GETs have neither; zarinpal/zibal callbacks unprotected; /api/health + logins unauthenticated by design |
| 6 | §13.5 cookies | ✅ PASS | admin session: httponly=True, samesite=lax, secure=True, max_age=SESSION_TTL_SEC(8h); admin csrf: httponly=False, lax, secure=True, 8h; user session: httponly=True, lax, secure=True, USER_SESSION_TTL_SEC(24h); user csrf: httponly=False, lax, secure=True, 24h |
| 7 | §18.5 account_belongs_to | ✅ PASS | body byte-identical to v2.14.1-stable (md5 match); our diff only ADDS callers (2 main.py gates, 2 web gates, BUG-30 batched stats predicate) — semantics unchanged |
| 8 | No new OWNER blocks | ✅ PASS | see reject-path inventory below — every new restriction has an OWNER escape or is a documented gate |

Full §13.2 endpoint auth/CSRF table (74 API routes; A=require_auth, UA=require_user_auth in-body, C=require_csrf, UC=require_user_csrf; "via C/UC" = auth enforced transitively because the csrf dep validates the session first):

```
METHOD   PATH                                               AUTH                        CSRF
GET      /                                                  (static index)             —
GET      /api/accounts                                      require_auth                —
DELETE   /api/accounts/{tag}                                via C                       require_csrf
GET      /api/accounts/{tag}                                require_auth                —
POST     /api/accounts/{tag}/disable                        via C                       require_csrf
POST     /api/accounts/{tag}/enable                         via C                       require_csrf
POST     /api/accounts/{tag}/login_guard                    via C                       require_csrf
PATCH    /api/accounts/{tag}/proxy                          via C                       require_csrf
GET      /api/analytics/audit-log                           require_auth                —
GET      /api/analytics/daily-revenue                       require_auth                —
GET      /api/analytics/export                              require_auth                —
GET      /api/analytics/overview                            require_auth                —
GET      /api/analytics/subscription-stats                   require_auth                —
GET      /api/audit-log                                     require_auth                —
POST     /api/auth/login                                    (login — by design)         —
POST     /api/auth/logout                                   (idempotent logout)         —
GET      /api/auth/me                                       via _valid_session          —
GET      /api/dashboard                                     require_auth                —
GET      /api/finance/payments                              require_auth                —
POST     /api/finance/payments/{pay_id}/approve             via C                       require_csrf
POST     /api/finance/payments/{pay_id}/reject              via C                       require_csrf
GET      /api/finance/stats                                 require_auth                —
GET      /api/health                                        (public health)             —
GET      /api/payment/zarinpal/callback                     (gateway redirect)          —
POST     /api/payment/zarinpal/create/{order_id}            require_user_auth           require_user_csrf
GET      /api/payment/zibal/callback                        (gateway redirect)          —
POST     /api/payment/zibal/create/{order_id}               require_user_auth           require_user_csrf
GET      /api/settings                                      require_auth                —
PATCH    /api/settings                                      via C                       require_csrf
GET      /api/tickets                                       require_auth                —
GET      /api/tickets/{ticket_id}                           require_auth                —
POST     /api/tickets/{ticket_id}/reply                     via C                       require_csrf
GET      /api/tools/api-creds                               require_auth                —
POST     /api/tools/api-creds                               via C                       require_csrf
POST     /api/tools/api-creds/rotate                        via C                       require_csrf
GET      /api/user/account/settings                         via _get_live_client        —
PATCH    /api/user/account/settings                         via _get_live_client        require_user_csrf
GET      /api/user/accounts                                 require_user_auth           —
GET      /api/user/affiliate/commissions                    require_user_auth           —
GET      /api/user/affiliate/stats                          require_user_auth           —
GET      /api/user/auto-renew                               require_user_auth           —
POST     /api/user/auto-renew                               require_user_auth           require_user_csrf
GET      /api/user/auto-replies                             require_user_auth           —
POST     /api/user/auto-replies                             require_user_auth           require_user_csrf
DELETE   /api/user/auto-replies/{reply_id}                  require_user_auth           require_user_csrf
GET      /api/user/chats                                    via _get_live_client        —
GET      /api/user/chats/{chat_id}/messages                 via _get_live_client        —
POST     /api/user/chats/{chat_id}/send                     via _get_live_client        require_user_csrf
GET      /api/user/live-session                             require_user_auth           —
POST     /api/user/live-session                             require_user_auth           require_user_csrf
POST     /api/user/live-session/stop                        require_user_auth           require_user_csrf
POST     /api/user/login                                    (login — by design)         —
POST     /api/user/logout                                   (idempotent logout)         —
GET      /api/user/me                                       require_user_auth           —
GET      /api/user/orders                                   require_user_auth           —
POST     /api/user/orders/{order_id}/pay-wallet             require_user_auth           require_user_csrf
POST     /api/user/pay-from-wallet                          require_user_auth           require_user_csrf
GET      /api/user/reseller-dashboard                       require_user_auth           —
GET      /api/user/scheduled-messages                       require_user_auth           —
POST     /api/user/scheduled-messages                       require_user_auth           require_user_csrf
DELETE   /api/user/scheduled-messages/{msg_id}              require_user_auth           require_user_csrf
GET      /api/user/wallet                                   require_user_auth           —
GET      /api/user/wallet/transactions                      require_user_auth           —
GET      /api/users                                         require_auth                —
DELETE   /api/users/{user_id}                               via C                       require_csrf
GET      /api/users/{user_id}                               require_auth                —
PATCH    /api/users/{user_id}                               via C                       require_csrf
POST     /api/users/{user_id}/extend                        via C                       require_csrf
GET      /api/users/{user_id}/wallet                        require_auth                —
POST     /api/users/{user_id}/wallet/credit                 via C                       require_csrf
POST     /api/users/{user_id}/wallet/debit                  via C                       require_csrf
GET      /api/version                                       require_auth                —
POST     /api/version/apply-update                          via C                       require_csrf
POST     /api/version/rollback                              via C                       require_csrf
(mounts: /app → web_static, /u → user panel, /api/docs,/api/redoc,/openapi.json,/docs/oauth2-redirect → docs; PANEL_DOCS_ENABLED-gated per §13.8)
```

Every NEW reject path added by the v2.14.2 operation, with OWNER treatment (all verified at runtime, 29/29 PASS):

| New reject path | Fix | Rejects | OWNER treatment | Rule |
|---|---|---|---|---|
| create_scheduled_message ownership gate | P1-1 BUG-2d | `{"error":"account_not_owned"}` for non-owner (user_id, tag) | **ESCAPE: `or is_owner_bypass(user_id)`** — ADMIN_ID + all OWNER_IDS pass on ANY tag (tested w/ OWNER_IDS member 999) | §20.1/§18.5 ✓ |
| create_auto_reply ownership gate | P2-1 residual | same | **ESCAPE: `or is_owner_bypass(user_id)`** (tested) | §20.1 ✓ |
| web POST /api/user/scheduled-messages gate | P1-5 BUG-2w + 2-ORCH | 404 unknown tag / 403 not-owner | 404 = input validation (tag nonexistent, equal for all); 403 has **ESCAPE: `or m.is_owner_bypass(uid)`** (2-ORCH landed it — P2-1's flagged gap closed) | §20.1 ✓ |
| web POST /api/user/auto-replies gate | P1-5 BUG-2w + 2-ORCH | same | same **OWNER escape** | §20.1 ✓ |
| role_add wizard gate | P1-3 BUG-34 | non-OWNER cannot add ADMIN/RESELLER | **documented §5.2 OWNER-ONLY gate** — `self._role() != ROLE_OWNER` rejects; OWNER = ADMIN_ID + OWNER_IDS (get_role multi-owner, tested); pattern-identical to sibling WIZ_ANNOUNCE | §5.2 ✓ |
| require_user_csrf (new dep on 11 user mutations) | P1-5 BUG-11w | 401 no session / 403 no csrf cookie / 403 bad header | cookie set AT user login + apiCall sends header → legit user/OWNER passes (tested); documented §13.2/§13.3 | §13.2 ✓ |
| require_csrf fail-closed (bypass removed) | P1-5 BUG-11w b | 403 when session cookie present but csrf cookie missing | OWNER gets csrf cookie IN the login response (before any mutation possible) → never blocked (tested); documented §13.3/§20.16 + v2.14.0 "require_csrf no bypass" | §4.5/§13.3 ✓ |
| /api/user/login rate limit 429 | P1-5 BUG-12w | 5 fails/IP/window → 15-min block | login endpoint ONLY (§4.4 verified); §13.4 documents it; block is per-IP on FAILED logins — successful OWNER login unaffected | §13.4/§4.4 ✓ |
| CSRF dep added to zarinpal/zibal create | 2-ORCH | require_user_csrf on the 2 payment-creates | same login-cookie mechanism; require_user_auth there was PRE-EXISTING (unchanged) | §13.2 ✓ |
| TRC20 fail-closed block_timestamp | P1-4 BUG-15 | rejects missing/unparsable/old/future tx timestamp | payment-verification of blockchain data (not role-based); §11.3-documented 24h window; equal for all payers | §11.3 ✓ |
| Generic 500/400 messages replacing str(e) | BUG-23w/P2-3 | same failure status codes as before, sanitized text | no new rejections — error paths already errored | §17.3/§20.5 ✓ |
| BUG-28w clamps, BUG-13 reorder, BUG-24/20663 backoff, wizard-pop reorder | various | none (clamp/reorder/robustness only) | BUG-13 actually REMOVES a false rejection (cooldown no longer burns quota) | §20.9/§20.10 ✓ |

Removed OWNER bypasses / role checks: **NONE** (zero `-` lines in the whole diff touch is_owner_bypass/ROLE_OWNER/role conditions).

Notes / flags for orchestrator:
1. PRE-EXISTING §4.8/§4.6 divergence (NOT introduced by our operation, left untouched per scope): v2.14.1 (commit b64fb2c) reverted v2.14.0's RBAC-CRIT-1/2 — authorize_sensitive_account_action uses single `actor_id == main_owner` (not is_owner_bypass → OWNER_IDS members lack owner bypass for sessions/2FA/login-code routes) and _toggle_login_guard carries the v2.12.31 DoS check that blocks the main owner from toggling login_guard on other users' accounts (rules §4.8 says OWNER may toggle ANY account; "login_guard:" is also back in SECURITY_ROUTES). Web-panel login_guard endpoint remains unrestricted for the panel OWNER (documented recovery path). Rules doc and v2.14.1 code disagree — needs an owner decision (fixing it is a behavior change, out of T8's test scope).
2. §13.4 says "5 failed/15 min" but shared machinery uses a 5-min failure window (pre-existing admin machinery replicated by P1-5; block duration 15 min matches doc). Same as P1-5's flag.
3. §13.5 cookies hardcode secure=True (pre-existing; fine behind nginx/localhost, matches rules' production assumption).
