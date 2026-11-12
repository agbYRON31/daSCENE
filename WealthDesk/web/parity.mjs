// Parity test: the web engine against the Swift engine, on every calculator.
// Generates thousands of inputs per run (examples, random variations in every input style,
// and invalid or edge-case entries), evaluates them with both engines, and requires the
// same field errors, rule errors, outputs and projection tables.
// Usage: node web/parity.mjs [casesPerCalculator]   (needs `swift build --product wdparity`)
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Engine, TaxData, Scientific, exampleInputs } from "./engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const resources = join(root, "Resources");
const catalog = JSON.parse(readFileSync(join(resources, "catalog.json"), "utf8"));
const taxData = new TaxData(JSON.parse(readFileSync(join(resources, "taxdata.json"), "utf8")));
const PER = Number(process.argv[2] || 60);

// Deterministic PRNG so failures are reproducible.
let seed = 20261111;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

function styled(v, field) {
  // Same number written the ways people type it.
  const s = String(Number(v.toPrecision(6)));
  if (field.unit === "$") {
    const abs = Math.abs(v);
    return pick([s, abs >= 1000 ? `${+(v / 1000).toPrecision(4)}k` : s, abs >= 1e6 ? `${+(v / 1e6).toPrecision(4)}m` : s,
      `$${Number(v.toFixed(2)).toLocaleString("en-US")}`, v < 0 ? `(${Math.abs(+v.toFixed(2))})` : s]);
  }
  if (field.unit === "%") return pick([s, s + "%"]);
  return s;
}

function variant(calc) {
  const ex = exampleInputs(calc), inputs = {};
  for (const f of calc.fields) {
    const e = ex[f.id];
    if (f.unit === "choice") { inputs[f.id] = pick([...(f.options || []).map((o) => String(o.value)), e]); continue; }
    if (f.default !== undefined && rnd() < 0.7) { inputs[f.id] = f.default; continue; }
    if (f.unit === "series") {
      const parts = e.split(";").map((x) => Number(x));
      const scale = 0.3 + rnd() * 1.6;
      let vals = parts.map((x) => +(x * scale * (0.8 + rnd() * 0.4)).toPrecision(5));
      if (rnd() < 0.1) vals = vals.slice(0, Math.max(1, vals.length - 1 - Math.floor(rnd() * 3)));
      inputs[f.id] = vals.join(pick(["; ", ";", "\n"]));
      continue;
    }
    let v = Number(e);
    if (!Number.isFinite(v)) { inputs[f.id] = e; continue; }
    const r = rnd();
    if (r < 0.70) v = v * (0.25 + rnd() * 1.75);
    else if (r < 0.80) v = v === 0 ? rnd() * 10 : -v * rnd();
    else if (r < 0.88) v = 0;
    else v = v * (2 + rnd() * 8);
    if (f.integer || ["years", "age", "count"].includes(f.unit)) v = Math.round(v);
    if (f.id === "sims") v = Math.max(1, Math.min(v, 3000));
    inputs[f.id] = styled(v, f);
  }
  // Occasionally break one field: blank, junk, or out of range.
  if (rnd() < 0.15) {
    const f = pick(calc.fields);
    inputs[f.id] = pick(["", "abc", "1.2.3", "-1e9", "99999999", "0", " 7 "]);
  }
  return inputs;
}

const cases = [];
for (const calc of catalog) {
  cases.push({ calc: calc.id, inputs: exampleInputs(calc) });
  for (let i = 0; i < PER; i++) cases.push({ calc: calc.id, inputs: variant(calc) });
}

const dir = mkdtempSync(join(tmpdir(), "wdparity-"));
const year = taxData.referenceYear;
writeFileSync(join(dir, "cases.json"), JSON.stringify({ year, cases }));
const bin = process.env.WDPARITY || join(root, ".build", "release", "wdparity");
execFileSync(bin, [resources, join(dir, "cases.json"), join(dir, "swift.json")], { stdio: "inherit" });
const swift = JSON.parse(readFileSync(join(dir, "swift.json"), "utf8"));

const engine = new Engine(catalog, taxData, year);
const asNum = (v) => (v === "NaN" ? NaN : v === "Infinity" ? Infinity : v === "-Infinity" ? -Infinity : v);
const same = (a, b) => {
  if (a === null || b === null) return a === b;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
};

let checked = 0, values = 0;
const failures = [];
cases.forEach((c, i) => {
  const calc = engine.calculator(c.calc), js = engine.evaluate(calc, c.inputs), sw = swift[i];
  const where = `${c.calc} ${JSON.stringify(c.inputs)}`;
  const fe = JSON.stringify(Object.entries(js.fieldErrors).sort()), sfe = JSON.stringify(Object.entries(sw.fieldErrors).sort());
  if (fe !== sfe) failures.push(`${where}\n    field errors: web ${fe} vs app ${sfe}`);
  if (JSON.stringify(js.ruleErrors) !== JSON.stringify(sw.ruleErrors)) failures.push(`${where}\n    rule errors: web ${JSON.stringify(js.ruleErrors)} vs app ${JSON.stringify(sw.ruleErrors)}`);
  if (js.outputs.length !== sw.outputs.length) failures.push(`${where}\n    output count ${js.outputs.length} vs ${sw.outputs.length}`);
  js.outputs.forEach((o, k) => {
    const s = sw.outputs[k];
    if (!s) return;
    values++;
    if ((o.error ?? null) !== (s.error ?? null)) failures.push(`${where}\n    ${o.id} error: web ${o.error} vs app ${s.error}`);
    else if (!same(o.value, asNum(s.value))) failures.push(`${where}\n    ${o.id}: web ${o.value} vs app ${s.value}`);
  });
  if (sw.rows || js.table) {
    const a = js.table?.rows ?? [], b = sw.rows ?? [];
    if (a.length !== b.length || a.some((r, ri) => r.some((v, ci) => { values++; return !same(v, asNum(b[ri][ci])); }))) {
      failures.push(`${where}\n    projection table differs`);
    }
  }
  checked++;
});

// Calculator page: the same typed lines through both engines' Scientific.evaluate, including
// keyboard-style input (5 x 3, 2x, 250k, 15%, 2(3 + 4), a trailing =) and lines that must fail.
const LINES = ["5 x 3", "5x3", "5 X 3", "(2)x(4)", "5 x -3", "x = 5", "x^2 + 1", "2x", "3x + 1", "x x 2", "2 x x", "2 x - 1",
  "k = 4", "2k", "250k", "1.2m", "3b", "2K + 1", "401k", "15%", "200 * 15%", "50% x 3", "2(3 + 4)", "(1 + 2)(3 + 4)", "2pi", "2 sqrt(9)",
  "pi(2)", "x(2)", "5 + 3 =", "y = 2 + 3 =", "x =", "= 5", "3 <= 4", "3 == 3", "limit401k(2026)", "2e3", "2e", "1e-05", "2 * (-5)",
  "z + 1", "5 x", "x", "ans * 2", "ans", "2 3", "6 × 7 − 2 ÷ 4", "2π", "sin(30)", "log(8, 2)", "fact(5)", "fact(2.5)", "sqrt(-1)", "1/0",
  "pi = 3", "1x = 2", "", "   ", "5 $ 3", "((2)", "ncr(5, 2) x 2", "abs(-3)k", "2 m", "m2", "x2", "5x2k", ".5k", "1,000"];
const POOL = ["5", "2.5", "250k", "1.2m", "3b", "1e-05", "15%", "7", "0", "x", "X", "k", "m", "z", "pi", "e", "ans", "sqrt(9)", "ncr(5, 2)",
  "sin(30)", "(", ")", " + ", " - ", " x ", "x", " * ", "/", "^", " ", "−", "×", "%", "=", "(2 + 3)"];
const lineCases = LINES.map((line) => ({ line, vars: { x: 3, k: 4 }, ans: 21, deg: true }))
  .concat(LINES.map((line) => ({ line, vars: {}, ans: null, deg: false })));
for (let i = 0; i < 2500; i++) {
  let line = "";
  const n = 1 + Math.floor(rnd() * 6);
  for (let j = 0; j < n; j++) line += pick(POOL);
  const vars = {};
  if (rnd() < 0.5) vars.x = Number((rnd() * 10 - 3).toFixed(2));
  if (rnd() < 0.3) vars.k = 4;
  if (rnd() < 0.2) vars.m = 2;
  lineCases.push({ line, vars, ans: rnd() < 0.5 ? 12.5 : null, deg: rnd() < 0.5 });
}
writeFileSync(join(dir, "lines.json"), JSON.stringify(lineCases.map((c) => (c.ans === null ? { ...c, ans: undefined } : c))));
execFileSync(bin, ["lines", resources, join(dir, "lines.json"), join(dir, "lines-swift.json")], { stdio: "inherit" });
const swiftLines = JSON.parse(readFileSync(join(dir, "lines-swift.json"), "utf8"));
let lineValues = 0;
lineCases.forEach((c, i) => {
  const sw = swiftLines[i];
  let js;
  try { const r = Scientific.evaluate(c.line, c.vars, c.ans, c.deg, engine.tax); js = { value: r.value, name: r.name }; }
  catch (e) { js = { error: e.message }; }
  const where = `line ${JSON.stringify(c.line)} vars ${JSON.stringify(c.vars)} ans ${c.ans}`;
  if ((js.error ?? null) !== (sw.error ?? null)) failures.push(`${where}\n    web ${js.error ?? js.value} vs app ${sw.error ?? sw.value}`);
  else if (js.error === undefined) {
    lineValues++;
    if (!same(js.value, sw.value)) failures.push(`${where}\n    web ${js.value} vs app ${sw.value}`);
    if ((js.name ?? null) !== (sw.name ?? null)) failures.push(`${where}\n    assigned name web ${js.name} vs app ${sw.name}`);
  }
});

const calcs = new Set(cases.map((c) => c.calc)).size;
if (failures.length) {
  console.log(`PARITY FAILED: ${failures.length} differences in ${checked} cases. First 25:`);
  for (const f of failures.slice(0, 25)) console.log("  ✗ " + f);
  process.exit(1);
}
console.log(`Parity OK: ${checked} cases across ${calcs} calculators, ${values} values identical to the Mac app's engine.`);
console.log(`Calculator page OK: ${lineCases.length} typed lines give the same result or the same message as the Mac app (${lineValues} results).`);
