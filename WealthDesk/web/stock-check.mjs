// Checks the stock screen's numbers: web/stock.js against the separately written reference
// (tools/stock_reference.py) and, when the Swift tool is built, the Mac app's engine (wdparity stock),
// on saved public data in Tests/stock_fixtures. Plus a few figures checked against the filings themselves.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./stock.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "Tests", "stock_fixtures");
const swift = process.argv[2] === "--no-mac" ? null : (process.argv[2] || [join(root, ".build", "release", "wdparity"), join(root, ".build", "debug", "wdparity")].find(existsSync));
let compared = 0, fails = 0;
const fail = (m) => { fails++; if (fails <= 40) console.log("FAIL " + m); };

function same(a, b, path, who) {
  if (a === null || a === undefined || b === null || b === undefined) {
    if ((a ?? null) !== (b ?? null)) fail(`${path}: ${who} ${JSON.stringify(b)} vs web ${JSON.stringify(a)}`);
    compared++; return;
  }
  if (typeof b === "number") {
    if (typeof a !== "number" || Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) fail(`${path}: ${who} ${b} vs web ${a}`);
    compared++; return;
  }
  if (Array.isArray(b)) {
    if (!Array.isArray(a) || a.length !== b.length) { fail(`${path}: length ${who} ${b.length} vs web ${a?.length}`); return; }
    b.forEach((x, i) => same(a[i], x, `${path}[${i}]`, who)); return;
  }
  if (typeof b === "object") { for (const k of Object.keys(b)) same(a[k], b[k], `${path}.${k}`, who); return; }
  if (a !== b) fail(`${path}: ${who} ${JSON.stringify(b)} vs web ${JSON.stringify(a)}`);
  compared++;
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
for (const f of files) {
  const p = join(dir, f), fx = JSON.parse(readFileSync(p, "utf8"));
  const web = analyze(fx);
  same(web, JSON.parse(execFileSync("python3", ["-I", join(root, "tools", "stock_reference.py"), p], { maxBuffer: 1 << 26 })), f, "reference");
  if (swift) same(web, JSON.parse(execFileSync(swift, ["stock", p], { maxBuffer: 1 << 26 })), f, "Mac");
}

// Figures read straight from the filings (independent of all three implementations).
const A = (t) => analyze(JSON.parse(readFileSync(join(dir, t + ".json"), "utf8")));
const near = (a, b, tol, m) => { compared++; if (a === null || Math.abs(a - b) > tol) fail(`${m}: ${a} expected ${b}`); };
const aapl = A("AAPL"), nvda = A("NVDA"), ko = A("KO"), jpm = A("JPM");
const row = (r, end) => r.annual.find((x) => x.end === end);
near(row(aapl, "2026-09-26")?.revenue, 478834000000, 0, "Apple FY2026 net sales (10-K)");
near(row(aapl, "2026-09-26")?.eps, 8.98, 1e-12, "Apple FY2026 diluted EPS (10-K)");
near(row(aapl, "2017-09-30")?.eps, 9.21 / 4, 1e-12, "Apple FY2017 diluted EPS $9.21 put on today's basis after the 2020 4-for-1 split");
near(row(nvda, "2017-01-29")?.eps, 2.57 / 40, 1e-12, "Nvidia FY2017 diluted EPS $2.57 after the 4-for-1 (2021) and 10-for-1 (2024) splits");
near(aapl.ttm.revenue, 478834000000, 0, "Apple trailing revenue right after a 10-K equals the fiscal year");
const kq = ko.ttm;
near(kq.revenue, 47941000000 + 39232000000 - 36119000000, 0, "Coca-Cola trailing revenue = FY2025 $47.941B + 2026 nine months $39.232B - 2025 nine months $36.119B (10-K, 10-Q)");
compared++; if (kq.revenueThrough !== "2026-10-02") fail("Coca-Cola trailing revenue should run through 2026-10-02");
compared++; if (jpm.valuation.evEbitda !== null) fail("JPMorgan: EV/EBITDA should be blank (banks don't report it)");
compared++; if (aapl.risk.betaMonths !== 60) fail("Apple beta should use 60 complete months");

console.log(fails ? `${fails} differences` : `Stock screen OK: ${files.length} companies, ${compared} values match the reference${swift ? " and the Mac app's engine" : ""} and the filings.`);
process.exit(fails ? 1 : 0);
