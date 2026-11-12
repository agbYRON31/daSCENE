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
// Keyboard-style lines on the Calculator page (same expectations as wdcheck in the Mac app).
const line = (t, vars = {}, ans = null) => { try { return Scientific.evaluate(t, vars, ans, false, engine.tax).value; } catch { return null; } };
const msg = (t, vars = {}) => { try { Scientific.evaluate(t, vars, null, false, engine.tax); return ""; } catch (e) { return e.message; } };
const near = (a, b) => a !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
expect(line("r = 5%") === 0.05 && line("50%") === 0.5 && line("200 * 15%") === 30, "% means ÷ 100");
expect(line("5 x 3") === 15 && line("5x3") === 15 && line("5 X 3") === 15 && line("(2)x(4)") === 8, "x between numbers multiplies");
expect(line("x^2 + 1", { x: 3 }) === 10 && line("2 * x", { x: 3 }) === 6 && line("x", { x: 3 }) === 3, "x as a variable");
expect(line("2x", { x: 3 }) === 6 && line("3x + 1", { x: 2 }) === 7, "number next to a variable multiplies");
expect(line("x x 2", { x: 3 }) === 6 && line("2 x x", { x: 3 }) === 6, "x times x-the-variable");
expect(line("2k", { k: 4 }) === 8, "a defined variable wins over the k suffix");
expect(line("250k") === 250000 && line("1.2m") === 1200000 && line("3b") === 3e9 && line("2K + 1") === 2001, "k / m / b suffixes");
expect(line("2(3 + 4)") === 14 && line("(1 + 2)(3 + 4)") === 21 && near(line("2pi"), 2 * Math.PI) && line("2 sqrt(9)") === 6, "implicit multiplication");
expect(line("5 x -3") === -15 && line("2 x - 1", { x: 3 }) === 5, "x before a sign");
expect(line("5 + 3 =") === 8 && line("y = 2 + 3 =") === 5, "a trailing = is ignored");
expect(line("limit401k(2026)") !== null && line("2e3") === 2000 && near(line("2e"), 2 * Math.E), "function names and scientific notation");
expect(msg("z + 1").includes("z = ") && msg("5 x").includes("×") && msg("2 3") !== "", "helpful errors");
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
