Task ID: T6
Agent: general-purpose (user frontend tests)
Task: PHASE 3 testing of CiaNet v2.14.2 USER panel frontend (web_static/u/): JS syntax, CSRF wrapper vm harness, mutation↔require_user_csrf coverage mapping, innerHTML escape sweep, proxy-password masking/submit logic, Vazirmatn font, fmtDate Jalali correctness, HTML sanity. Read-only vs repo; all artifacts in /tmp/t6/.

Work Log:
- Mandatory reads: CIANET_RULES_AND_POLICIES.md §13 (13.2 user CSRF = X-CSRF-Token + cianet_user_csrf_token double-submit; 13.3 401/403 fail-closed; 13.4 login rate-limit; login/logout exempt) and §17 (Persian-first i18n, UI conventions). worklog.md 0-PLAN (CSRF regression history, phase partitioning), P1-7 (u/ fixes: BUG-11u/23u/31/33), P2-7 (residual escapes + 11-endpoint cross-check), 2-ORCH (payment-create endpoints got require_user_csrf; no frontend callers exist).
- Read all 12 u/ files fully + web_panel.py read-only (require_user_csrf def 254-284, all user routes, login cookie-setting 1693-1710, rate limit 1655-1686) + main.py:4084 (order_no provenance `ORD-{seq:05d}`).
- T1 JS syntax: `node --check u/app.js` → OK (node v24.21.0). Extractor (/tmp/t6/extract_inline.js) pulled every non-src <script> block from all 10 u/ pages: 5 inline scripts (account_settings, accounts, chats, live, orders — 1.5-5.3 KB each) → `node --check` each → all OK; 5 pages (dashboard, index, login, settings, wallet) have no inline scripts. PASS.
- T2 CSRF wrapper (/tmp/t6/csrf_harness.js, node vm + stubbed document/fetch): app.js loaded in vm context. 11/11 assertions PASS: (A) POST with `cianet_user_csrf_token=tok123` mid-cookie-string → header `X-CSRF-Token: tok123` exactly + Content-Type preserved; (B) GET with cookie → header absent; (C) POST with NO cookie → no header, no throw, login body intact (works header-less pre-cookie); (D) cookie at start of document.cookie → still matched (PATCH); (E) only admin cookie `cianet_csrf_token` present → no header (cookie-name strict). PASS.
- T3 Mutation coverage: grep `apiCall(` across u/ → 16 invocations (single `fetch(` only inside apiCall — zero bypasses; no XHR/axios/sendBeacon/document.write/eval). 7 non-GET sites (below). Read web_panel.py route decorators: 13 `require_user_csrf` endpoints = 11 (P1-5) + 2 payment-create (2-ORCH). Mapping verified BOTH directions; grep `pay-from-wallet|auto-renew|scheduled-messages|auto-replies|zarinpal|zibal` in u/ → 0 hits (bot/API-only). PASS.
- T4 Escape sweep: static classification of all 51 innerHTML interpolation points (9 template sites) + dynamic harness (/tmp/t6/escape_harness.js): malicious payloads (`<img onerror>`, attribute-breakout `"><img…><svg onload>`) driven through renderAccounts (incl. data-tag attr + state fallback), renderTxs (txTypeLabel fallback), renderForm (all value= attrs), renderChats/renderMessages, renderOrders (status fallback, discount, pay-btn), live loadLive — no raw tag / no event-handler in real tag / no attribute breakout / raw payload forms absent; escaped forms present. 3 early harness false-positives fixed (naive onerror regex matching entity-escaped TEXT; appendChild not capturing createElement'd nodes; wrong `&lt;script>` expectation) — final: ALL PASS. PASS.
- T5 Password masking (/tmp/t6/password_harness.js): runs page's own loadSettings() via fetch stub (so script-scope `original` binds correctly — sandbox-global assignment is invisible to closures, found while testing). 14/14 assertions PASS: R1 type=password + value="" + placeholder + autocomplete=new-password, stored secret absent from DOM; R2 typed "NewTyped!2026" wins in PATCH payload (full proxy dict round-trips: addr/port/username/rdns); R3 empty typed → stored `original.proxy.password` ("StoredSecret#99") re-sent (backend dict-replace compat); R4 no stored password → key absent (undefined, not ""); R5 proxy_type "" → proxy null; R6 result via textContent; R7 secret still absent from DOM after submit. PASS.
- T6 Font: styles.css:8-21 two @font-face 'Vazirmatn' (400 Regular + 700 Bold), jsdelivr rastikerdar/vazirmatn@v33.003 woff2, font-display swap; body chain `'Vazirmatn', 'Segoe UI', Tahoma, system-ui, sans-serif` (:44); remaining font-family decls = inherit/mono only. `curl -sI` both URLs → HTTP/2 200 (immutable, CORS ok). PASS.
- T7 fmtDate (/tmp/t6/fmtdate_harness.js): 15/15 PASS. Fixed input 2026-10-06T12:00:00 → `۱۴۰۵/۷/۱۴, ۱۲:۰۰`: Jalali year ۱۴۰۵ + month ۷ + day ۱۴, ALL digits Persian, HH:MM time; cross-checked against fa-IR long form `۱۴ مهر ۱۴۰۵` (month ۷ = مهر, i.e. مهر ۱۴۰۵ ✓). SQLite "YYYY-MM-DD HH:MM:SS", epoch-ms, Date-object inputs → identical output; null/undefined/""/garbage → ''. Second known conversion 2026-01-01 → ۱۴۰۴/۱۰/۱۱ (`۱۱ دی ۱۴۰۴`) ✓. All 4 date sites use fmtDate: app.js:197 (renderTxs), orders.html:67, chats.html:76, live.html:49 (epoch-ms). PASS.
- T8 HTML sanity (/tmp/t6/html_sanity.sh): 9/10 pages have all 4 markers (dir="rtl", viewport, src="app.js", href="styles.css"). Exception: index.html — 11-line meta-refresh redirect stub (0s → login.html) with dir="rtl"+charset but no viewport/app.js/styles.css. git-verified UNMODIFIED since upstream commit bd1ed54 (v2.8.3) — pre-existing design, not a regression from fix phases; zero functional impact (instant redirect, no content/data/scripts needed; auth guard runs on target page). Verdict: PASS with 1 documented non-functional exception.
- No repo modifications: `git status` identical to post-Phase-2 state (7 u/ files modified by P1-7/P2-7, untouched by T6); all artifacts under /tmp/t6/ (dom_stub.js + 6 harnesses + 5 extracted inline scripts); read-only access to web_panel.py/main.py.

Stage Summary:
- Verdicts: T1 JS syntax PASS · T2 CSRF wrapper PASS (11/11) · T3 Mutation coverage PASS (7 frontend mutations ↔ server CSRF, 13 protected endpoints all mapped) · T4 Escape sweep PASS (51/51 safe + dynamic payload tests) · T5 Password masking PASS (14/14) · T6 Font PASS (static + 2×HTTP 200) · T7 fmtDate PASS (15/15, مهر ۱۴۰۵ verified) · T8 HTML sanity PASS w/ 1 documented exception (index.html redirect stub, upstream design).
- 8/8 tests PASS overall (T8 with the index.html caveat). No bugs found in the u/ frontend; no fixes required.

Endpoint ↔ frontend mapping (u/ panel, all via apiCall — single fetch, no bypass):

| # | Frontend site | Method | Endpoint | Server CSRF | Status |
|---|---------------|--------|----------|-------------|--------|
| 1 | app.js:99 | POST | /api/user/login | exempt (sets cookie; rate-limit 5/15min §13.4) | ✓ header-less pre-cookie works |
| 2 | app.js:120 | POST | /api/user/logout | exempt (clears cookies) | ✓ |
| 3 | chats.html:124 | POST | /api/user/chats/{id}/send | require_user_csrf (web_panel.py:2841) | ✓ |
| 4 | accounts.html:70 | POST | /api/user/live-session | require_user_csrf (:2909) | ✓ |
| 5 | live.html:58 | POST | /api/user/live-session/stop | require_user_csrf (:2955) | ✓ |
| 6 | account_settings.html:136 | PATCH | /api/user/account/settings | require_user_csrf (:2741) | ✓ |
| 7 | orders.html:93 | POST | /api/user/orders/{id}/pay-wallet | require_user_csrf (:1857) | ✓ |

Reverse direction — all 13 require_user_csrf endpoints (11 P1-5 + 2 payment-create):
| Server endpoint | Method | web_panel.py | u/ caller |
|-----------------|--------|--------------|-----------|
| /api/user/orders/{id}/pay-wallet | POST | 1857 | orders.html:93 ✓ |
| /api/user/account/settings | PATCH | 2741 | account_settings.html:136 ✓ |
| /api/user/chats/{id}/send | POST | 2841 | chats.html:124 ✓ |
| /api/user/live-session | POST | 2909 | accounts.html:70 ✓ |
| /api/user/live-session/stop | POST | 2955 | live.html:58 ✓ |
| /api/user/pay-from-wallet | POST | 1801 | none — bot/API-only (grep 0 hits) |
| /api/user/auto-renew | POST | 2481 | none — bot/API-only |
| /api/user/scheduled-messages | POST/DELETE | 2528/2556 | none — bot/API-only |
| /api/user/auto-replies | POST/DELETE | 2571/2588 | none — bot/API-only |
| /api/payment/zarinpal/create/{order_id} | POST | 2314 | none — gateway API (2-ORCH: "no frontend callers — nothing breaks") |
| /api/payment/zibal/create/{order_id} | POST | 2614 | none — gateway API |

→ No frontend mutation calls an unprotected endpoint; no protected endpoint is missing its frontend caller where one is needed. 9 GET apiCall sites (me/wallet/transactions/accounts/chats/messages/live-session/settings/orders) need no CSRF per §13.2.

Escape sweep stats (51 innerHTML interpolation points, T5-equivalent classification):
- escapeHtml: 30 (renderTxs reason+txTypeLabel-fallback 2; renderAccounts name/tag×2/data-tag/state-fallback/note 5; renderForm tag/tg_user_id/live_name/live_phone/live_username + value= phone/api_id/api_hash/proxy.addr/port/username 11; renderChats name 1; renderMessages sender_name/text 2; loadLive tag/name/tg_user_id/phone 4; orders order_no/plan/status-fallback/discount_code + payBtn order_no 5)
- fmt output (fmtDate / fa-IR toLocaleTimeString): 5
- numeric (faDigits / int fields): 9
- literal / literal-conditional (typeIcon, selected×3, checked×2, disabled-ternary): 7
- Provenance-safe: orders.html:74 onclick order_no — escapeHtml covers attribute boundary; JS-string context safe because order_no is server-generated `ORD-{seq:05d}` (main.py:4084, charset [A-Z0-9-]). Same class T5 tolerated for admin onclick ints.
- Non-HTML sinks (safe): 20+ textContent sites (dashboard/wallet/errors/save-result/chat-header), className property assignments, encodeURIComponent URL building, addEventListener closures, alert/confirm. Password input: value="" literal — stored secret never interpolated into DOM (R1/R7 verified).

Artifacts: /tmp/t6/{extract_inline.js, csrf_harness.js, dom_stub.js, escape_harness.js, password_harness.js, font_harness.js, fmtdate_harness.js, html_sanity.sh, inline_*.js} — all re-runnable.
