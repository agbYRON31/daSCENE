// Scenario files must open in both directions between the web version and the Mac app.
// Usage: node web/scenario-check.mjs   (needs `swift build --product wdparity`)
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scenarioFileText, readScenarioFile } from "./scenario.js";

const bin = process.env.WDPARITY || join(dirname(fileURLToPath(import.meta.url)), "..", ".build", "release", "wdparity");
const dir = mkdtempSync(join(tmpdir(), "wdscenario-"));
const swift = (...a) => execFileSync(bin, a, { encoding: "utf8" }).trim();
let failures = 0;
const expect = (ok, msg) => { if (!ok) { failures++; console.log("  ✗ " + msg); } };

for (const pw of ["", "correct horse ⚑ battery"]) {
  const label = pw ? "encrypted" : "plain";
  // web → Mac
  const webFile = join(dir, `web-${label}.wealthdesk`);
  writeFileSync(webFile, await scenarioFileText("cagr", "From the web", { start: "100", end: "250", years: "7" }, pw || null));
  expect(swift("scenario-read", webFile, pw) === "cagr|From the web|end=250,start=100,years=7", `Mac app reads a ${label} web file`);
  // Mac → web
  const macFile = join(dir, `mac-${label}.wealthdesk`);
  swift("scenario-write", macFile, pw);
  const s = await readScenarioFile(readFileSync(macFile, "utf8"), pw || null);
  expect(s.calculatorID === "fv_lump" && s.title === "From the Mac app" && s.inputs.pv === "10000", `web reads a ${label} Mac file`);
}
let rejected = false;
try { await readScenarioFile(await scenarioFileText("cagr", "x", {}, "right"), "wrong"); } catch (e) { rejected = /Wrong password/.test(e.message); }
expect(rejected, "a wrong password is rejected");

if (failures) { console.log(`Scenario file interop FAILED (${failures}).`); process.exit(1); }
console.log("Scenario files open both ways between the web and the Mac app (plain and password-protected).");
