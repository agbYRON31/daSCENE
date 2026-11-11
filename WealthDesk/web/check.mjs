// Self-test for the web engine, the JavaScript twin of `swift run wdcheck`.
// Evaluates every calculator at its example inputs and compares each output with the
// expected value computed by tools/build_catalog.py. Usage: node web/check.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Engine, TaxData, Expression, Finance, Scientific, exampleInputs } from "./engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const resources = join(here, "..", "Resources");
const catalog = JSON.parse(readFileSync(join(resources, "catalog.json"), "utf8"));
const taxData = new TaxData(JSON.parse(readFileSync(join(resources, "taxdata.json"), "utf8")));
const engine = new Engine(catalog, taxData, taxData.referenceYear);

let passed = 0;
const failures = [];
const close = (a, b) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(b));
const expect = (cond, msg) => (cond ? passed++ : failures.push(msg));

for (const calc of engine.calculators) {
  const ev = engine.evaluate(calc, exampleInputs(calc));
  if (Object.keys(ev.fieldErrors).length || ev.ruleErrors.length) {
    failures.push(`${calc.id}: example inputs rejected: ${JSON.stringify(ev.fieldErrors)} ${ev.ruleErrors}`);
    continue;
  }
  for (const o of calc.outputs) {
    const got = ev.outputs.find((x) => x.id === o.id);
    const v = got?.value;
    const e = o.expected;
    if ((e === null || e === undefined) && Number.isNaN(v)) passed++;
    else if (e !== null && e !== undefined && v !== null && v !== undefined && close(v, e)) passed++;
    else failures.push(`${calc.id}.${o.id} ${o.label}: expected ${e}, got ${v} ${got?.error ?? ""}`);
  }
  if (calc.projection && !(ev.table?.rows.length)) failures.push(`${calc.id}: projection produced no table`);
}

// Input handling and parser checks (same as wdcheck)
const dollar = { id: "x", label: "x", unit: "$", example: "1", hint: "", min: 0 };
const pct = { id: "p", label: "p", unit: "%", example: "1", hint: "", max: 1 };
const tryParse = (raw, f) => { try { return Engine.parse(raw, f); } catch { return null; } };
expect(tryParse("250k", dollar) === 250000, "250k should parse");
expect(tryParse("$1.2m", dollar) === 1200000, "$1.2m should parse");
expect(tryParse("1,500", dollar) === 1500, "1,500 should parse");
expect(tryParse("7", pct) === 0.07, "7 in a % field is 7%");
expect(tryParse("7%", pct) === 0.07, "7% in a % field is 7%");
expect(tryParse("-5", dollar) === null, "negative dollars rejected by min 0");
expect(tryParse("150", pct) === null, "150% rejected by max 100%");
expect(tryParse("abc", dollar) === null, "text rejected");
expect(tryParse("", dollar) === null, "empty rejected");
expect(new Expression("-2^2").number({}, engine.tax) === -4, "-2^2 = -4");
expect(new Expression("2^3^2").number({}, engine.tax) === 512, "^ is right-associative");
let threw = false;
try { Finance.irr([-100, 50, -20, 90]); } catch { threw = true; }
expect(threw, "IRR rejects multiple sign changes");
expect(Scientific.evaluate("x = 2*3", {}, null, false, engine.tax).value === 6, "scratchpad assignment");
expect(Math.abs(Scientific.evaluate("sin(30)", {}, null, true, engine.tax).value - 0.5) < 1e-12, "degrees mode");

// IRS bracket base amounts, every year and status: tax at each bracket floor equals the
// cumulative tax of the brackets below it.
for (const t of taxData.tables) {
  for (const status of Object.keys(t.ordinaryBrackets)) {
    const b = t.ordinaryBrackets[status];
    let cum = 0;
    for (let i = 0; i < b.length; i++) {
      expect(Math.abs(t.incomeTax(b[i][0], Number(status)) - cum) < 1e-6, `${t.taxYear} status ${status} bracket ${i} base`);
      if (i + 1 < b.length) cum += (b[i + 1][0] - b[i][0]) * b[i][1];
    }
  }
}

if (failures.length) {
  console.log(`FAILED ${failures.length} of ${passed + failures.length} checks:`);
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log(`All ${passed} checks passed.`);
