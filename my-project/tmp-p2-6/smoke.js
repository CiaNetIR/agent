// Smoke-test app.js CSRF wrapper + escapeHtml with stubbed document/fetch
let cookieStr = "";
global.document = {
  get cookie() { return cookieStr; },
  set cookie(v) { cookieStr = v; },
  addEventListener() {},
  getElementById() { return { innerHTML: "", textContent: "", className: "", classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } } }; },
  querySelector() { return null; },
};
const calls = [];
global.fetch = async (path, opts) => {
  calls.push({ path, opts });
  return { ok: true, status: 200, statusText: "OK", json: async () => ({ ok: true }) };
};
global.location = { href: "", pathname: "/app/users.html" };
const src = require("fs").readFileSync("/home/z/cianet-review/web_static/app.js", "utf8");
// strip the auto-run authGuard call to avoid fetch during load
eval(src.replace("authGuard();", "/* authGuard skipped in test */"));

(async () => {
  let pass = 0, fail = 0;
  const t = (name, cond) => { cond ? (pass++, console.log("PASS", name)) : (fail++, console.log("FAIL", name)); };

  // 1) getCsrfToken: no cookie → "" (login case, must not crash)
  cookieStr = "";
  t("getCsrfToken empty when no cookie", getCsrfToken() === "");

  // 2) POST with cookie → X-CSRF-Token header = cookie value
  cookieStr = "other=1; cianet_csrf_token=abc123__-XYZ; more=2";
  t("getCsrfToken exact value", getCsrfToken() === "abc123__-XYZ");
  calls.length = 0;
  await api("/api/users/1/extend", { method: "POST", body: "{}" });
  t("POST sends X-CSRF-Token", calls[0].opts.headers["X-CSRF-Token"] === "abc123__-XYZ");
  t("POST keeps Content-Type", calls[0].opts.headers["Content-Type"] === "application/json");
  t("POST keeps credentials include", calls[0].opts.credentials === "include");

  // 3) GET → no CSRF header
  calls.length = 0;
  await api("/api/users");
  t("GET has no X-CSRF-Token", !("X-CSRF-Token" in calls[0].opts.headers));

  // 4) POST with no cookie (login) → no header, no crash
  cookieStr = "";
  calls.length = 0;
  await api("/api/auth/login", { method: "POST", body: "{}" });
  t("login POST omits header when no cookie", !("X-CSRF-Token" in calls[0].opts.headers));

  // 5) lowercase method normalized
  cookieStr = "cianet_csrf_token=tok9";
  calls.length = 0;
  await api("/x", { method: "delete" });
  t("lowercase delete gets header", calls[0].opts.headers["X-CSRF-Token"] === "tok9");

  // 6) escapeHtml coverage
  t("escapeHtml &<\">'", escapeHtml(`<img src=x onerror="a('b')">&`) === "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  t("escapeHtml null/undefined/number", escapeHtml(null) === "" && escapeHtml(undefined) === "" && escapeHtml(0) === "0" && escapeHtml(12345) === "12345");

  // 7) sidebar includes analytics link + layout has toggle/backdrop
  const sb = sidebar("users.html");
  t("sidebar has analytics link", sb.includes('href="analytics.html"'));
  t("sidebar marks active", sb.includes('class="active"'));
  const lay = layout("<div>x</div>");
  t("layout injects sidebarToggle", lay.includes('id="sidebarToggle"'));
  t("layout injects backdrop", lay.includes('id="sidebarBackdrop"'));
  t("layout escapes nothing in content", lay.includes("<div>x</div>"));

  // 8) renderError markup contains retry + escaped message
  cookieStr = "";
  document.getElementById = () => ({ set innerHTML(v) { global.__lastRender = v; } });
  renderError(new Error("<script>alert(1)</script>"));
  t("renderError escapes message", global.__lastRender.includes("&lt;script&gt;") && !global.__lastRender.includes("<script>alert"));
  t("renderError has retry button", global.__lastRender.includes("location.reload()"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
