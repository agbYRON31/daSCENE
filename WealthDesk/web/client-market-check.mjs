// Checks Client Mode's market-conditions summary (web/client_market.js).
//   node web/client-market-check.mjs [model.json ...]
// With no arguments it checks the two models the original Python RoRo engine produced
// (Tests/roro_expected*.json) plus dist/web/data/roro.json when a full build has made one.
//
// For every model it confirms that the page shows the engine's numbers unchanged, labels
// them with the model's own ±20 lines, and that those numbers hang together: each fast
// (unsmoothed) dial is recomputed independently from the six bucket scores and the
// published weights, and every dial matches the last point of its own history line.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clientMarketSummary, marketWord, marketTone, BUCKET_PLAIN, LINE } from "./client_market.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let passed = 0;
const failures = [];
const expect = (ok, msg) => (ok ? passed++ : failures.push(msg));

// 1. The words, at and around the lines (same rule as the Mac app: >= +20, <= −20).
const words = [[100, "Supportive"], [20, "Supportive"], [19.99, "Mixed"], [0, "Mixed"], [-19.99, "Mixed"],
  [-20, "Stressed"], [-100, "Stressed"], [null, "No reading"], [undefined, "No reading"], [NaN, "No reading"]];
for (const [v, w] of words) expect(marketWord(v) === w, `marketWord(${v}) should be ${w}, got ${marketWord(v)}`);
expect(LINE === 20, "the lines are at ±20, as in the RoRo model");
expect(marketTone(20) === "pos" && marketTone(-20) === "neg" && marketTone(5) === "neu" && marketTone(null) === "", "colour follows the word");
expect(clientMarketSummary(null) === null && clientMarketSummary({}) === null, "no model, no summary");

// 2. Each model.
const paths = process.argv.slice(2);
if (!paths.length) {
  paths.push(join(root, "Tests", "roro_expected.json"), join(root, "Tests", "roro_expected_2022-06-16.json"));
  const built = join(root, "dist", "web", "data", "roro.json");
  if (existsSync(built)) paths.push(built);
}
const lastNum = (a) => { for (let i = (a?.length ?? 0) - 1; i >= 0; i--) if (typeof a[i] === "number") return a[i]; return null; };
const HKEYS = ["tactical", "intermediate", "strategic"];

for (const path of paths) {
  const name = path.replace(root + "/", "");
  const m = JSON.parse(readFileSync(path, "utf8"));
  const s = clientMarketSummary(m);
  const say = (msg) => `${name}: ${msg}`;
  if (!s) { failures.push(say("no summary")); continue; }

  expect(s.indicators === m.n_live, say(`indicator count ${s.indicators} vs model ${m.n_live}`));
  expect(s.horizons.length === 3 && m.horizons.length === 3, say("three dials"));
  m.horizons.forEach((z, i) => {
    expect(s.horizons[i].value === z.value, say(`${z.label} shows ${s.horizons[i].value}, model ${z.value}`));
    expect(s.horizons[i].word === marketWord(z.value), say(`${z.label} word`));
  });
  expect(s.overall.value === m.horizons[1].value, say("overall reading is the medium-term (Intermediate) dial"));
  expect(s.overall.value === m.posture?.value, say(`overall ${s.overall.value} matches the model's posture value ${m.posture?.value}`));
  expect(s.headline.includes(`“${s.overall.word.toLowerCase()}”`), say("headline uses the overall word"));

  expect(s.buckets.length === m.buckets.length && m.buckets.length === 6, say("six buckets"));
  m.buckets.forEach((b, i) => {
    expect(s.buckets[i].value === b.score, say(`${b.key} shows ${s.buckets[i].value}, model ${b.score}`));
    expect(s.buckets[i].label === BUCKET_PLAIN[b.key], say(`${b.key} has a plain-language label`));
    expect(s.buckets[i].word === marketWord(b.score), say(`${b.key} word`));
  });

  const series = m.history.intermediate;
  const nonNull = series.filter((v) => typeof v === "number").length;
  expect(s.history.length === nonNull, say(`chart has ${s.history.length} points, model has ${nonNull}`));
  expect(s.history.every((p, i, a) => i === 0 || a[i - 1].x < p.x), say("chart dates run forward"));
  expect(s.history.at(-1)?.y === lastNum(series), say("chart ends at the latest reading"));

  // Independent arithmetic: each dial's latest value is the last point of its history line
  // (dial rounded to a whole number, history to 0.1).
  HKEYS.forEach((k, i) => {
    const h = lastNum(m.history[k]);
    expect(Math.abs(m.horizons[i].value - h) <= 0.5 + 0.05 + 1e-9, say(`${k} dial ${m.horizons[i].value} vs history ${h}`));
  });
  // The fast dial is not smoothed, so it must equal the weighted average of today's six
  // bucket scores with the published weights (bucket scores are rounded to whole numbers).
  const w = m.weights?.tactical;
  if (w) {
    const live = m.buckets.filter((b) => typeof b.score === "number");
    const wsum = live.reduce((a, b) => a + (w[b.key] ?? 0), 0);
    const calc = live.reduce((a, b) => a + (w[b.key] ?? 0) * b.score, 0) / wsum;
    const hist = lastNum(m.history.tactical);
    expect(Math.abs(calc - hist) <= 0.5 + 0.05, say(`fast dial recomputed from buckets ${calc.toFixed(2)} vs engine ${hist}`));
    expect(Math.abs(calc - m.horizons[0].value) <= 1, say(`fast dial recomputed ${calc.toFixed(2)} vs shown ${m.horizons[0].value}`));
  } else failures.push(say("model has no weights"));
  for (const k of HKEYS) {
    const tw = Object.values(m.weights?.[k] ?? {}).reduce((a, b) => a + b, 0);
    expect(tw === 100, say(`${k} weights add to 100 (got ${tw})`));
  }
  console.log(`  ${name}: as of ${m.asof} · ${s.horizons.map((z) => `${z.label} ${z.value} ${z.word}`).join(" · ")}`);
}

if (failures.length) {
  failures.forEach((f) => console.log("FAIL  " + f));
  console.log(`${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`Client market summary: all ${passed} checks passed.`);
