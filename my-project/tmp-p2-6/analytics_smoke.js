// Functional smoke: analytics error handlers (DOM-stubbed) + auth redirect logic
const created = [];
function fakeEl(id) {
  return {
    id, style: {}, className: "", textContent: "", _children: [], parentNode: { children: [],
      insertBefore(n) { this.children.push(n); } },
    append(...n) { this._children.push(...n); },
  };
}
global.document = {
  _els: {},
  getElementById(id) { return this._els[id] || (this._els[id] = fakeEl(id)); },
  createElement(tag) { const el = fakeEl("<"+tag+">"); created.push(el); return el; },
};
global.window = global;
let fetchStatus = 200;
global.fetch = async () => ({ status: fetchStatus, ok: fetchStatus < 400, json: async () => ({}) });
let redirectedTo = null;
global.location = { get href() { return this._h || "/app/analytics.html"; }, set href(v) { redirectedTo = v; this._h = v; } };
// stub Chart constructor
global.Chart = function (el, cfg) { if (!el) throw new Error("no canvas"); };
const html = require("fs").readFileSync("/home/z/cianet-review/web_static/analytics.html", "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
eval(code);
(async () => {
  let pass = 0, fail = 0;
  const t = (n, c) => { c ? (pass++, console.log("PASS", n)) : (fail++, console.log("FAIL", n)); };

  // 1) 401 on /api/auth/me → redirect to login
  fetchStatus = 401;
  redirectedTo = null;
  await (async () => {
    if (await checkAdminAuth()) { Promise.all([loadOverview(), loadRevenueChart(), loadSubChart()]); }
    else { window.location.href = '/app/login.html'; }
  })();
  t("401 → redirects to login", redirectedTo === "/app/login.html");

  // 2) network error on auth check → NOT redirected (returns true)
  global.fetch = async () => { throw new Error("network down"); };
  redirectedTo = null;
  t("network error → no redirect (checkAdminAuth true)", (await checkAdminAuth()) === true && redirectedTo === null);

  // 3) overview failure → Persian error + retry button, message NOT in innerHTML
  global.fetch = async () => { throw new Error("<img onerror=x>"); };
  global.document._els = {}; created.length = 0;
  await loadOverview();
  const sg = global.document._els["stat-grid"];
  const errBox = created.find(e => e.className === "error" && e.textContent.includes("خطا"));
  const retry = created.find(e => e.textContent === "🔄 تلاش مجدد");
  t("overview error shows Persian box", !!errBox && sg._children.includes(errBox));
  t("overview error has retry button", !!retry && retry.onclick instanceof Function && sg._children.includes(retry));
  t("error message via textContent only (no innerHTML)", sg.innerHTML === undefined);

  // 4) chart failure → visible Persian error, canvas hidden
  created.length = 0; global.document._els = {};
  await loadRevenueChart();
  const chartErr = created.find(e => e.className === "error" && e.textContent.includes("نمودار"));
  t("revenue chart error visible", !!chartErr);
  t("canvas hidden on error", global.document._els["revenueChart"].style.display === "none");
  created.length = 0; global.document._els = {};
  await loadSubChart();
  t("sub chart error visible", !!created.find(e => e.className === "error" && e.textContent.includes("نمودار")));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
