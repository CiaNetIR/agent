// Extract every inline <script> block from admin HTML pages and node --check each
const fs = require("fs"), path = require("path"), cp = require("child_process");
const dir = "/home/z/cianet-review/web_static";
const pages = ["dashboard.html","users.html","accounts.html","finance.html","tickets.html","audit.html","tools.html","settings.html","version.html","analytics.html","login.html"];
let fail = 0;
for (const p of pages) {
  const html = fs.readFileSync(path.join(dir, p), "utf8");
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html)) !== null) {
    i++;
    const code = m[1];
    if (!code.trim()) { console.log(`${p} [script ${i}]: EMPTY (skip)`); continue; }
    const tmp = `/home/z/my-project/tmp-p2-6/${p}.script${i}.js`;
    fs.writeFileSync(tmp, code);
    try {
      cp.execSync(`node --check ${JSON.stringify(tmp)}`, { stdio: "pipe" });
      console.log(`${p} [script ${i}]: OK (${code.length} chars)`);
    } catch (e) {
      fail++;
      console.log(`${p} [script ${i}]: FAIL\n${e.stderr}`);
    }
  }
  if (i === 0) console.log(`${p}: NO inline scripts`);
}
process.exit(fail ? 1 : 0);
