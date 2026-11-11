// Wealth Desk for the web. Same catalog, tax tables and engine as the macOS app
// (see engine.js). Everything runs in this browser tab: nothing typed is stored or sent,
// and it is gone when the tab closes.
import {
  Engine, TaxData, Format, Scientific, fieldKind, usesTaxTable, exampleInputs, blankInputs, categories, search,
} from "./engine.js";

// ---------------------------------------------------------------------------
// State (memory only)

const S = {
  engine: null,
  client: {},          // store key → { fieldId → typed text }
  advisor: {},         // calculator id → inputs
  taxTab: 0,
  compare: false,
  calc: { tape: [], vars: {}, ans: null, degrees: false },
  sidebarQuery: "",
};
const app = document.getElementById("app");
let charts = [];

// ---------------------------------------------------------------------------
// Small DOM helpers

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
const svgIcon = (d) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "icon"); s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  for (const part of d.split("|")) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", part); s.append(p);
  }
  return s;
};
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { toast("Couldn't copy. Your browser blocked clipboard access."); }
}
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const today = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const prettyDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

// Coalesces rapid input (slider drags) into one redraw. A timer rather than
// requestAnimationFrame so background tabs still update.
let frame = 0;
const schedule = (fn) => { clearTimeout(frame); frame = setTimeout(fn, 16); };

// ---------------------------------------------------------------------------
// Charts (Chart.js)

function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

const vlinePlugin = {
  id: "vline",
  afterDatasetsDraw(chart, _args, opts) {
    if (opts?.x === undefined || opts.x === null) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(opts.x);
    if (x < chartArea.left || x > chartArea.right) return;
    ctx.save();
    ctx.strokeStyle = cssVar("--muted"); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = cssVar("--muted"); ctx.font = "12px " + cssVar("--sans");
    ctx.fillText(opts.label || "", x + 4, chartArea.top + 12);
    ctx.restore();
  },
};

function chart(type, data, { money = "y", xTitle, stacked = false, legend = true, vline, indexAxis, xType } = {}) {
  const canvas = h("canvas");
  const box = h("div", { class: "chartbox" + (indexAxis === "y" ? " short" : "") }, canvas);
  // Created after the node is in the document (see mountCharts).
  box._make = () => {
    if (!window.Chart) return;
    const grid = cssVar("--grid"), muted = cssVar("--muted");
    const moneyTicks = { color: muted, callback: (v) => Format.compact(v) };
    const plainTicks = { color: muted };
    const linear = xType === "linear";
    const c = new window.Chart(canvas, {
      type, data,
      plugins: [vlinePlugin],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, indexAxis,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: legend, labels: { color: muted, boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${Format.currency(indexAxis === "y" ? ctx.parsed.x : ctx.parsed.y)}` } },
          vline: vline || {},
        },
        elements: { point: { radius: 0, hitRadius: 6 } },
        scales: indexAxis === "y" ? {
          x: { type: "linear", stacked, grid: { color: grid }, ticks: moneyTicks, beginAtZero: true },
          y: { type: "category", stacked, grid: { display: false }, ticks: plainTicks },
        } : {
          x: {
            type: linear ? "linear" : "category", stacked,
            grid: { color: grid }, ticks: { ...plainTicks, precision: 0 },
            title: xTitle ? { display: true, text: xTitle, color: muted } : undefined,
          },
          y: { stacked, grid: { color: grid }, ticks: money === "y" ? moneyTicks : plainTicks, beginAtZero: true },
        },
      },
    });
    charts.push(c);
  };
  return box;
}
function mountCharts(root) { root.querySelectorAll(".chartbox").forEach((b) => b._make && b._make()); }

// ---------------------------------------------------------------------------
// Client Mode

const F = (id, label, lo, hi, step, blank) => ({ id, label, range: [lo, hi], step, blank });
const Spec = {
  growth: [F("p", "Starting amount", 0, 2e6, 5000, "0"), F("m", "Added each month", 0, 10000, 50, "0"),
    F("r", "Yearly return", 0, 12, 0.25), F("y", "Years", 1, 50, 1), F("infl", "Inflation", 0, 8, 0.25, "0")],
  retirementYou: [F("age", "Age today", 18, 90, 1), F("retire", "Retirement age", 40, 80, 1),
    F("bal", "Invested today", 0, 5e6, 10000, "0"), F("c", "Saved per year until retirement", 0, 200000, 1000, "0"),
    F("spend", "Yearly spending in retirement (today's dollars)", 0, 500000, 5000),
    F("other", "Other yearly retirement income (Social Security, pension)", 0, 200000, 1000, "0")],
  retirementAssumptions: [F("rpre", "Yearly return before retirement", 0, 12, 0.25), F("rpost", "Yearly return in retirement", 0, 12, 0.25),
    F("infl", "Inflation", 0, 8, 0.25), F("plan", "Plan through age", 70, 110, 1, "95"),
    F("oage", "Other income starts at age", 55, 75, 1, "67"), F("cg", "Yearly increase in saving", 0, 10, 0.5, "0"),
    F("sd", "Market ups and downs (volatility)", 0, 30, 1)],
  risk: [F("v", "Portfolio value", 0, 1e7, 50000), F("we", "Stocks", 0, 100, 5), F("wb", "Bonds", 0, 100, 5),
    F("eq", "Stock market change", -60, 40, 1), F("dy", "Interest-rate change", -3, 3, 0.25, "0"),
    F("dur", "Bond duration (years of rate sensitivity)", 0, 15, 0.5, "6"), F("infl", "Inflation over the period", 0, 10, 0.5, "0"),
    F("w", "Withdrawal during the period", 0, 500000, 5000, "0")],
  volatility: [F("sa", "Stock volatility", 0, 40, 1), F("sb", "Bond volatility", 0, 20, 0.5),
    F("rho", "How stocks and bonds move together (−1 to 1)", -1, 1, 0.05)],
  decisionLevers: [F("retire", "Retirement age", 40, 80, 1), F("c", "Saved per year", 0, 200000, 1000),
    F("spend", "Yearly retirement spending", 0, 500000, 5000), F("rpre", "Return before retirement", 0, 12, 0.25)],
  inflation: [F("c", "Amount in today's dollars", 0, 1e6, 1000), F("i", "Inflation", 0, 10, 0.25), F("n", "Years", 1, 50, 1)],
  taxDrag: [F("a", "Amount invested", 0, 2e6, 5000), F("r", "Yearly return", 0, 12, 0.25),
    F("t", "Tax rate on investment earnings", 0, 50, 1), F("n", "Years", 1, 50, 1)],
  incomeTax: [F("ti", "Taxable income", 0, 2e6, 5000)],
};
Spec.retirement = [...Spec.retirementYou, ...Spec.retirementAssumptions];

const TOOLS = [
  { id: "growth", title: "How does my money grow?", blurb: "See what regular saving and compound growth can add up to.",
    icon: "M3 17l6-6 4 4 8-8|M14 7h7v7" },
  { id: "retirement", title: "Am I on track for retirement?", blurb: "Project savings to and through retirement, and how long they could last.",
    icon: "M12 2a3 3 0 100 6 3 3 0 000-6z|M12 8v6l-3 8|M12 14l3 8|M8 11h8" },
  { id: "risk", title: "How much investment risk am I taking?", blurb: "See what a market drop or a rate change would do to a portfolio mix.",
    icon: "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z|M12 2v20" },
  { id: "decisions", title: "How do my decisions change my future?", blurb: "Compare two choices side by side: retire earlier, save more, spend less.",
    icon: "M6 3v12|M18 9a3 3 0 100-6 3 3 0 000 6z|M6 21a3 3 0 100-6 3 3 0 000 6z|M18 9c0 6-12 3-12 9" },
  { id: "taxes", title: "How do taxes and inflation affect my money?", blurb: "See what inflation does to buying power and what taxes take from growth.",
    icon: "M19 5L5 19|M6.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5z|M17.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" },
];

const raw = (key, id) => S.client[key]?.[id] ?? "";
const setRaw = (key, id, v) => { (S.client[key] ||= {})[id] = v; };

function clientRun(key, calcID, fields, overrides = {}) {
  const calc = S.engine.calculator(calcID);
  if (!calc) return null;
  const inputs = blankInputs(calc);
  for (const f of calc.fields) {
    const typed = String(overrides[f.id] ?? raw(key, f.id)).trim();
    const spec = fields.find((x) => x.id === f.id);
    if (typed) inputs[f.id] = typed; else if (spec?.blank !== undefined) inputs[f.id] = spec.blank;
  }
  const labels = Object.fromEntries(fields.map((x) => [x.id, x.label]));
  const ev = S.engine.evaluate(calc, inputs);
  const blank = (id) => !String(inputs[id] ?? "").trim();
  return {
    calc, inputs, ev, labels,
    ok: Engine.isComplete(ev),
    v: (i) => ev.outputs[i]?.value ?? NaN,
    missing: calc.fields.filter((f) => ev.fieldErrors[f.id] && blank(f.id)).map((f) => labels[f.id] ?? f.label),
    problems: [
      ...calc.fields.filter((f) => ev.fieldErrors[f.id] && !blank(f.id)).map((f) => `${labels[f.id] ?? f.label}: ${ev.fieldErrors[f.id]}`),
      ...ev.ruleErrors,
    ],
  };
}

function inputRow(key, calcID, field, onChange) {
  const unit = S.engine.calculator(calcID)?.fields.find((f) => f.id === field.id)?.unit ?? "x";
  const [lo, hi] = field.range;
  const sliderValue = () => {
    const r = raw(key, field.id) || field.blank || "";
    let v;
    try { v = Engine.parseNumber(r, false); } catch { v = lo; }
    return Math.min(Math.max(v, lo), hi);
  };
  const id = `in-${key}-${field.id}`.replace(/\W/g, "_");
  const text = h("input", {
    type: "text", id, inputmode: "decimal", autocomplete: "off", class: unit === "$" ? "money" : null,
    placeholder: field.blank ?? "", value: raw(key, field.id),
    oninput: () => { setRaw(key, field.id, text.value); slider.value = sliderValue(); onChange(); },
  });
  const slider = h("input", {
    type: "range", min: lo, max: hi, step: field.step, value: sliderValue(), "aria-label": field.label,
    oninput: () => {
      const stepped = Math.round(Number(slider.value) / field.step) * field.step;
      const s = Format.plain(stepped, field.step < 1 ? 2 : 0);
      text.value = s; setRaw(key, field.id, s); onChange();
    },
  });
  return h("div", { class: "crow" },
    h("div", { class: "crow-top" },
      h("label", { for: id, text: field.label }),
      h("span", { class: "box" }, unit === "$" ? "$" : null, text, unit === "%" ? "%" : null)),
    slider);
}
const inputs = (key, calcID, fields, onChange) => fields.map((f) => inputRow(key, calcID, f, onChange));
const group = (title, note, ...kids) => h("div", { class: "group" },
  h("p", { class: "group-title", text: title }), note ? h("p", { class: "group-note", text: note }) : null, ...kids);

const headline = (text, cap) => h("div", { class: "headline" }, h("div", { class: "big", text }), cap ? h("div", { class: "cap", text: cap }) : null);
const stat = (label, value, cap, negative) => h("div", { class: "stat" },
  h("div", { class: "stat-label", text: label }), h("div", { class: "stat-value" + (negative ? " neg" : ""), text: value, title: value }),
  cap ? h("div", { class: "stat-cap", text: cap }) : null);
const stats = (...kids) => h("div", { class: "stats" }, ...kids);
const chartCard = (title, note, ...kids) => h("div", { class: "chartcard" }, h("h3", { text: title }), ...kids, note ? h("p", { class: "note", text: note }) : null);
const footnote = () => h("p", { class: "footnote", text: "These are educational illustrations based only on the numbers typed in. They are not advice, a recommendation or a prediction. Nothing typed here is saved or sent; it is erased when this tab closes." });

function needsInput(c) {
  if (!c) return h("div", { class: "needs" }, "This tool is unavailable.");
  return h("div", { class: "needs" },
    c.problems.map((p) => h("div", { class: "problem", text: p })),
    c.missing.length ? [h("h3", { text: "To see the picture, fill in:" }), h("ul", {}, c.missing.map((m) => h("li", { text: m })))] : null);
}

function howItWorks(calcs) {
  return h("details", { class: "how" },
    h("summary", { text: "How this is calculated, and what it assumes" }),
    calcs.map((c) => h("div", { class: "how-item" },
      h("h4", { text: c.calc.name }),
      h("code", { text: c.calc.math }),
      h("p", { text: c.calc.assumptions }),
      h("p", { text: c.calc.interpretation }),
      h("button", { class: "linkbtn no-print", text: "Open the full calculator in Advisor Mode",
        onclick: () => { S.advisor[c.calc.id] = { ...c.inputs }; location.hash = `#/advisor/${c.calc.id}`; } }))));
}

function taxBanner() {
  const t = S.engine.tax;
  const src = t.sources[0]?.title.split(" (")[0] ?? "IRS publications";
  return h("div", { class: "banner" },
    `IRS figures for tax year ${t.taxYear} · verified ${prettyDate(t.verifiedOn)} against ${src}. Change the year at the top of the page.`,
    t.notes.map((n) => h("div", { class: "note", text: "ⓘ " + n })));
}

function printHead(kind, title) {
  return h("div", { class: "print-head" }, h("strong", { text: `Wealth Desk · ${kind}` }), ` · ${title} · ${today()}`);
}

function clientHome() {
  return h("div", { class: "home" },
    h("h1", { text: "What would you like to explore?" }),
    h("p", { class: "lede", text: "Pick a question, type in any numbers, and watch the picture change." }),
    h("div", { class: "cards" }, TOOLS.map((t) => h("a", { class: "card-link", href: `#/client/${t.id}` },
      svgIcon(t.icon), h("h2", { text: t.title }), h("p", { text: t.blurb })))),
    footnote());
}

function toolLayout(tool, inputPanel, renderResults) {
  const results = h("div", { class: "tool-results-inner" });
  const refresh = () => schedule(() => {
    destroyCharts();
    results.replaceChildren();
    append(results, [printHead("Client illustration", tool.title), h("h1", { text: tool.title }), renderResults(), footnote()]);
    mountCharts(results);
  });
  const panel = h("aside", { class: "tool-inputs" }, h("a", { class: "back", href: "#/client", text: "← All questions" }));
  const fill = () => { const back = panel.firstChild; panel.replaceChildren(back); append(panel, [inputPanel(refresh, fill)]); };
  fill();
  refresh();
  return h("div", { class: "tool" }, panel, h("section", { class: "tool-results" }, results));
}

// 1. Growth
function growthTool(tool) {
  return toolLayout(tool, (on) => [
    group("Your numbers", null, inputs("client.growth", "growth_schedule", Spec.growth.slice(0, 2), on)),
    group("Assumptions", "These are yours to set. A return is an assumption, not a promise.", inputs("client.growth", "growth_schedule", Spec.growth.slice(2), on)),
  ], () => {
    const c = clientRun("client.growth", "growth_schedule", Spec.growth);
    if (!c?.ok || !c.ev.table) return needsInput(c);
    const rows = c.ev.table.rows, years = rows.length ? rows[rows.length - 1][0] : 0;
    return [
      headline(`After ${years} years this could grow to ${Format.currency(c.v(0))}.`,
        `${Format.currency(c.v(1))} is money put in; ${Format.currency(c.v(2))} is growth on top of it.`),
      stats(stat("Ending balance", Format.currency(c.v(0))), stat("Money put in", Format.currency(c.v(1))),
        stat("Growth earned", Format.currency(c.v(2)), null, c.v(2) < 0),
        stat("What it buys in today's dollars", Format.currency(c.v(3)), "After the inflation entered")),
      chartCard("Year by year", "Growth compounds: each year's gains earn gains of their own. Dashed line: the balance in today's dollars.",
        chart("line", {
          datasets: [
            { label: "Money put in", data: rows.map((r) => ({ x: r[0], y: r[1] })), fill: "origin", stack: "a", backgroundColor: hexA(cssVar("--cash"), 0.45), borderColor: cssVar("--cash"), borderWidth: 1 },
            { label: "Growth", data: rows.map((r) => ({ x: r[0], y: Math.max(r[2], 0) })), fill: "-1", stack: "a", backgroundColor: hexA(cssVar("--accent"), 0.55), borderColor: cssVar("--accent"), borderWidth: 1 },
            { label: "Balance in today's dollars", data: rows.map((r) => ({ x: r[0], y: r[4] })), stack: "b", borderColor: cssVar("--muted"), borderDash: [4, 3], borderWidth: 1.5, fill: false },
          ],
        }, { xType: "linear", stacked: true, xTitle: "Years from now" })),
      howItWorks([c]),
    ];
  });
}

// 2. Retirement
function retirementTool(tool) {
  return toolLayout(tool, (on) => [
    group("About you", null, inputs("client.retirement", "retirement_mc", Spec.retirementYou, on)),
    group("Assumptions", "Leave volatility empty for a single steady path, or enter it to see a range of outcomes.",
      inputs("client.retirement", "retirement_mc", Spec.retirementAssumptions, on)),
  ], () => {
    const t = clientRun("client.retirement", "retirement_timeline", Spec.retirement);
    const hasVol = raw("client.retirement", "sd").trim() !== "";
    const mc = hasVol ? clientRun("client.retirement", "retirement_mc", Spec.retirement) : null;
    if (!t?.ok || !t.ev.table) return needsInput(t);
    const rows = t.ev.table.rows;
    const plan = (rows.length ? rows[rows.length - 1][0] : 0) + 1;
    const lasts = t.v(3) < 0;
    const rate = t.v(0) > 0 ? t.v(1) / t.v(0) : NaN;
    const band = mc?.ok ? mc.ev.table.rows : [];
    const accent = cssVar("--accent");
    const datasets = [];
    if (band.length) {
      datasets.push({ label: "90th percentile", data: band.map((r) => ({ x: r[0], y: r[3] })), borderWidth: 0, fill: "+1", backgroundColor: hexA(accent, 0.18), pointRadius: 0 });
      datasets.push({ label: "10th percentile", data: band.map((r) => ({ x: r[0], y: r[1] })), borderWidth: 0, fill: false, pointRadius: 0 });
    }
    datasets.push({ label: "Steady path", data: rows.map((r) => ({ x: r[0] + 1, y: r[5] })), borderColor: accent, borderWidth: 2.5, fill: false });
    const retire = Number(t.inputs.retire);
    return [
      headline(lasts ? `On this steady path the money lasts through age ${plan}.` : `On this steady path the money runs out around age ${Math.trunc(t.v(3))}.`,
        lasts ? `About ${Format.currency(t.v(2))} would remain at the end of the plan.` : `That is ${Math.trunc(plan - t.v(3))} years before the end of the plan.`),
      stats(
        stat("Savings at retirement", Format.currency(t.v(0))),
        stat("First-year withdrawal", Format.currency(t.v(1)), Number.isNaN(rate) ? null : `${Format.percent(rate)} of savings at retirement`),
        stat(lasts ? "Left at end of plan" : "Money runs out at age", lasts ? Format.currency(t.v(2)) : String(Math.trunc(t.v(3))), null, !lasts),
        mc?.ok ? stat("Simulated paths where the money lasts", Format.percent(mc.v(0)), `Out of ${mc.inputs.sims} random market paths`) : null),
      chartCard("Savings over time",
        mc?.ok ? "Shaded band: the middle 80% of simulated outcomes. Solid line: the steady path. Markets don't deliver the same return every year, so the band is the more realistic picture."
          : "A single steady path with the same return every year. Enter a volatility assumption to see a range.",
        chart("line", { datasets }, { xType: "linear", xTitle: "Age", legend: false, vline: Number.isFinite(retire) ? { x: retire, label: "Retire" } : null })),
      mc && !mc.ok ? needsInput(mc) : null,
      howItWorks([t, ...(mc?.ok ? [mc] : [])]),
    ];
  });
}

// 3. Risk
function riskTool(tool) {
  const mixB = () => {
    const over = {};
    for (const id of ["we", "wb"]) if (raw("client.risk.B", id)) over[id] = raw("client.risk.B", id);
    return clientRun("client.risk", "portfolio_stress", Spec.risk, over);
  };
  const vol = () => {
    const over = {};
    for (const id of ["v", "we", "wb"]) over[id] = raw("client.risk", id);
    for (const id of ["sa", "sb", "rho"]) over[id] = raw("client.risk.vol", id);
    return clientRun("client.risk.none", "mix_volatility", [...Spec.risk, ...Spec.volatility], over);
  };
  const bars = (c, name) => {
    const n = (id) => { try { return Engine.parse(c.inputs[id] ?? "", c.calc.fields.find((f) => f.id === id)); } catch { return null; } };
    const v = n("v"), we = n("we"), wb = n("wb");
    if (v === null || we === null || wb === null) return null;
    const s = v * we, b = v * wb, cash = v - s - b;
    return { labels: [`${name} today`, `${name} after`], stocks: [s, s + c.v(0)], bonds: [b, b + c.v(1)], cash: [cash, cash] };
  };
  return toolLayout(tool, (on, refill) => [
    group("Portfolio", "Whatever isn't in stocks or bonds is treated as cash.", inputs("client.risk", "portfolio_stress", Spec.risk.slice(0, 3), on)),
    group("What if…", "You choose the scenario. This shows what would happen if it occurred, not how likely it is.",
      inputs("client.risk", "portfolio_stress", Spec.risk.slice(3), on)),
    group("Compare another mix", null,
      h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: S.compare, onchange: (e) => { S.compare = e.target.checked; refill(); on(); } }), "Show a second mix side by side"),
      S.compare ? inputs("client.risk.B", "portfolio_stress", [F("we", "Stocks (mix B)", 0, 100, 5), F("wb", "Bonds (mix B)", 0, 100, 5)], on) : null),
    group("Typical ups and downs (optional)", "Enter volatility assumptions to see how much the mix usually moves in a year.",
      inputs("client.risk.vol", "mix_volatility", Spec.volatility, on)),
  ], () => {
    const a = clientRun("client.risk", "portfolio_stress", Spec.risk);
    const b = S.compare ? mixB() : null;
    const vc = vol();
    if (!a?.ok) return needsInput(a);
    const down = a.v(2) < 0;
    const ba = bars(a, "Mix A"), bb = b?.ok ? bars(b, "Mix B") : null;
    const labels = [...(ba?.labels ?? []), ...(bb?.labels ?? [])];
    const series = (k) => [...(ba?.[k] ?? []), ...(bb?.[k] ?? [])];
    return [
      headline(`In this scenario the portfolio would be about ${Format.currency(Math.abs(a.v(2)))} ${down ? "lower" : "higher"} (${Format.percent(a.v(3))}).`,
        "A what-if based on the changes entered. It is not a forecast and says nothing about how likely this is."),
      stats(stat("Change in value", Format.currency(a.v(2)), null, down), stat("Change in percent", Format.percent(a.v(3)), null, down),
        stat("Value afterwards", Format.currency(a.v(4)), "After any withdrawal entered"),
        stat("From stocks / from bonds", `${Format.compact(a.v(0))} / ${Format.compact(a.v(1))}`)),
      b?.ok ? chartCard("Mix A compared with mix B", "Same scenario, two different mixes.",
        stats(stat("Mix A change", Format.currency(a.v(2)), Format.percent(a.v(3)), a.v(2) < 0),
          stat("Mix B change", Format.currency(b.v(2)), Format.percent(b.v(3)), b.v(2) < 0),
          stat("Difference (B − A)", Format.currency(b.v(2) - a.v(2)))))
        : (S.compare && b ? needsInput(b) : null),
      chartCard("Before and after", "Bond values are estimated from duration: a 1% rise in rates lowers bond prices by roughly the duration in percent.",
        chart("bar", {
          labels,
          datasets: [
            { label: "Stocks", data: series("stocks"), backgroundColor: cssVar("--accent") },
            { label: "Bonds", data: series("bonds"), backgroundColor: cssVar("--bond") },
            { label: "Cash", data: series("cash"), backgroundColor: cssVar("--cash") },
          ],
        }, { stacked: true })),
      vc?.ok ? chartCard("Typical ups and downs", "Volatility is a yardstick for normal fluctuation, not a worst case and not a prediction.",
        stats(stat("Volatility of this mix", Format.percent(vc.v(0)), "Standard deviation of yearly returns, from your assumptions"),
          stat("A typical one-year swing", "± " + Format.currency(vc.v(1))),
          stat("Share of the risk from stocks", Format.percent(vc.v(2))))) : null,
      howItWorks([a, ...(vc?.ok ? [vc] : [])]),
    ];
  });
}

// 4. Decisions
function decisionsTool(tool) {
  const optionB = () => {
    const over = {};
    for (const f of Spec.decisionLevers) if (raw("client.decisions.B", f.id).trim()) over[f.id] = raw("client.decisions.B", f.id);
    return clientRun("client.retirement", "retirement_timeline", Spec.retirement, over);
  };
  const lasts = (c) => (c.v(3) < 0 ? "Lasts through the plan" : `Runs out at age ${Math.trunc(c.v(3))}`);
  const row = (label, x, y) => {
    const d = y - x;
    return h("tr", {}, h("td", { text: label }), h("td", { class: "n", text: Format.currency(x) }), h("td", { class: "n", text: Format.currency(y) }),
      h("td", { class: "n " + (d < 0 ? "negtxt" : "pos"), text: (d >= 0 ? "+" : "") + Format.currency(d) }));
  };
  return toolLayout(tool, (on) => [
    group("Option A: the starting plan", "Shared with “Am I on track for retirement?”.",
      inputs("client.retirement", "retirement_mc", Spec.retirementYou, on),
      inputs("client.retirement", "retirement_mc", Spec.retirementAssumptions.slice(0, 3), on)),
    group("Option B: change one or more things", "Leave a box empty to keep it the same as option A.",
      inputs("client.decisions.B", "retirement_mc", Spec.decisionLevers, on)),
  ], () => {
    const a = clientRun("client.retirement", "retirement_timeline", Spec.retirement);
    const b = optionB();
    const changed = Spec.decisionLevers.some((f) => raw("client.decisions.B", f.id).trim());
    if (!(a?.ok && b?.ok && a.ev.table && b.ev.table)) return needsInput(a?.ok ? b : a);
    const diff = b.v(2) - a.v(2);
    return [
      changed ? headline(`Option B ends the plan with ${Format.currency(Math.abs(diff))} ${diff >= 0 ? "more" : "less"} than option A.`, `A: ${lasts(a)}. B: ${lasts(b)}.`)
        : headline("Change something under Option B to compare.", "For example: retire five years earlier, save more each year, or spend less in retirement."),
      h("div", { class: "panel" }, h("table", { class: "compare" },
        h("thead", {}, h("tr", {}, h("th", {}), h("th", { text: "Option A" }), h("th", { text: "Option B" }), h("th", { text: "Difference" }))),
        h("tbody", {},
          row("Savings at retirement", a.v(0), b.v(0)),
          row("First-year withdrawal", a.v(1), b.v(1)),
          row("Left at end of plan", a.v(2), b.v(2)),
          h("tr", {}, h("td", { text: "How long the money lasts" }), h("td", { text: lasts(a) }), h("td", { text: lasts(b) }), h("td", {}))))),
      chartCard("Savings over time", "Both lines use a steady return every year. Real markets vary; see the retirement tool for a range of outcomes.",
        chart("line", {
          datasets: [
            { label: "Option A", data: a.ev.table.rows.map((r) => ({ x: r[0] + 1, y: r[5] })), borderColor: cssVar("--cash"), borderWidth: 2.5 },
            { label: "Option B", data: b.ev.table.rows.map((r) => ({ x: r[0] + 1, y: r[5] })), borderColor: cssVar("--accent"), borderWidth: 2.5 },
          ],
        }, { xType: "linear", xTitle: "Age" })),
      howItWorks([a]),
    ];
  });
}

// 5. Taxes and inflation
function taxesTool(tool) {
  return toolLayout(tool, (on, refill) => {
    const tabs = ["Inflation", "Taxes on growth", "Income tax"];
    const seg = h("div", { class: "segmented", role: "tablist" }, tabs.map((t, i) =>
      h("button", { class: S.taxTab === i ? "active" : null, role: "tab", "aria-selected": String(S.taxTab === i), text: t,
        onclick: () => { S.taxTab = i; refill(); on(); } })));
    if (S.taxTab === 0) return [seg, group("Inflation and buying power", null, inputs("client.inflation", "inflation_cost", Spec.inflation, on))];
    if (S.taxTab === 1) return [seg, group("Taxes on investment growth", "Compares paying tax on earnings every year with paying once at the end.",
      inputs("client.taxdrag", "tax_deferral", Spec.taxDrag, on))];
    const f = S.engine.calculator("income_tax").fields.find((x) => x.id === "status");
    const current = raw("client.incometax", "status") || f.example;
    return [seg, group("Federal income tax estimate", "Federal tax on ordinary taxable income only. No state tax, credits or other taxes.",
      inputs("client.incometax", "income_tax", Spec.incomeTax, on),
      h("div", { class: "crow" }, h("div", { class: "crow-top" }, h("label", { for: "status", text: "Filing status" }),
        h("select", { id: "status", onchange: (e) => { setRaw("client.incometax", "status", e.target.value); on(); } },
          f.options.map((o) => h("option", { value: Format.plain(o.value), selected: Format.plain(o.value) === current, text: o.label }))))))];
  }, () => {
    if (S.taxTab === 0) {
      const c = clientRun("client.inflation", "inflation_cost", Spec.inflation);
      if (!c?.ok) return needsInput(c);
      const n = Math.trunc(Number(c.inputs.n));
      const pts = [];
      for (let k = 0; k <= n; k++) {
        const v = S.engine.evaluate(c.calc, { ...c.inputs, n: String(k) }).outputs[1]?.value;
        if (v !== null && v !== undefined) pts.push({ x: k, y: v });
      }
      let amount = c.inputs.c;
      try { amount = Format.currency(Engine.parse(c.inputs.c, c.calc.fields[0])); } catch { /* keep text */ }
      return [
        headline(`What costs ${amount} today would cost about ${Format.currency(c.v(0))} in ${n} years.`,
          `Put another way, that same amount of money would then buy only what ${Format.currency(c.v(1))} buys today.`),
        stats(stat("Future cost of the same thing", Format.currency(c.v(0))), stat("Buying power of today's amount, later", Format.currency(c.v(1)), null, true)),
        chartCard("Buying power over time", "Each point is the same calculation for that many years.",
          chart("line", { datasets: [{ label: "Buying power", data: pts, borderColor: cssVar("--accent"), backgroundColor: hexA(cssVar("--accent"), 0.2), fill: "origin", borderWidth: 2 }] },
            { xType: "linear", xTitle: "Years from now", legend: false })),
        howItWorks([c]),
      ];
    }
    if (S.taxTab === 1) {
      const c = clientRun("client.taxdrag", "tax_deferral", Spec.taxDrag);
      if (!c?.ok) return needsInput(c);
      return [
        headline(`Paying tax on earnings every year leaves ${Format.currency(c.v(0))}. Deferring the tax to the end leaves ${Format.currency(c.v(1))}.`,
          `The difference, ${Format.currency(c.v(2))}, comes from letting untaxed gains keep compounding.`),
        chartCard("Ending value after tax", null, chart("bar", {
          labels: ["Taxed every year", "Taxed once at the end"],
          datasets: [{ label: "Ending value", data: [c.v(0), c.v(1)], backgroundColor: [cssVar("--cash"), cssVar("--accent")] }],
        }, { legend: false })),
        howItWorks([c]),
      ];
    }
    const c = clientRun("client.incometax", "income_tax", Spec.incomeTax);
    let income = null;
    try { income = Engine.parse(c?.inputs.ti ?? "", c.calc.fields[0]); } catch { /* not ready */ }
    if (!c?.ok || income === null) return [taxBanner(), needsInput(c)];
    return [
      taxBanner(),
      headline(`Estimated federal income tax: ${Format.currency(c.v(0))}, which is ${Format.percent(c.v(2))} of this income.`,
        `The next dollar earned would be taxed at ${Format.percent(c.v(1))}. That higher rate applies only to income above the bracket line, not to all of it.`),
      stats(stat("Federal income tax", Format.currency(c.v(0))), stat("Average rate on this income", Format.percent(c.v(2))),
        stat("Rate on the next dollar", Format.percent(c.v(1))),
        stat("Room before the next bracket", Number.isNaN(c.v(3)) ? "Top bracket" : Format.currency(c.v(3)))),
      chartCard("Where the income goes", null, chart("bar", {
        labels: ["Income"],
        datasets: [
          { label: "Kept after federal income tax", data: [income - c.v(0)], backgroundColor: cssVar("--accent") },
          { label: "Federal income tax", data: [c.v(0)], backgroundColor: cssVar("--warn") },
        ],
      }, { stacked: true, indexAxis: "y", money: "x" })),
      howItWorks([c]),
    ];
  });
}

function hexA(color, alpha) {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Advisor Mode

function sidebar(activeId) {
  const list = h("div");
  const fill = () => {
    const q = S.sidebarQuery.trim();
    const calcs = S.engine.calculators;
    const link = (c) => h("a", { href: `#/advisor/${c.id}`, class: c.id === activeId ? "active" : null },
      c.name, c.acronym ? h("span", { class: "acr", text: c.acronym }) : null);
    if (q) {
      const hits = search(q, calcs);
      list.replaceChildren(hits.length ? h("div", {}, h("h4", { text: `${hits.length} match${hits.length === 1 ? "" : "es"}` }), hits.map(link))
        : h("p", { class: "muted", style: "padding: 8px", text: "No calculator matches." }));
    } else {
      list.replaceChildren(...categories(calcs).map((cat) => h("div", {}, h("h4", { text: cat }), calcs.filter((c) => c.category === cat).map(link))));
    }
  };
  fill();
  const box = h("input", { type: "search", placeholder: `Search ${S.engine.calculators.length} calculators`, value: S.sidebarQuery, "aria-label": "Search calculators",
    oninput: () => { S.sidebarQuery = box.value; fill(); } });
  return h("nav", { class: "sidebar", id: "sidebar" }, box, list);
}

function advisorShell(activeId, content) {
  const side = sidebar(activeId);
  const toggle = h("button", { class: "btn menu-toggle", text: "Browse calculators", onclick: () => side.classList.toggle("open") });
  return h("div", { class: "advisor" }, side, h("section", { class: "content" }, h("div", { class: "content-inner" }, toggle, content)));
}

function advisorHome() {
  const calcs = S.engine.calculators;
  return advisorShell(null, h("div", { class: "advisor-home" },
    h("h1", { text: "Advisor Mode" }),
    h("p", { class: "muted", text: `${calcs.length} calculators with formulas, assumptions, Excel equivalents and sources. Each one is checked against an independent reference implementation. Search on the left, or start with a common one:` }),
    h("div", { class: "chips" }, calcs.filter((c) => c.common).map((c) => h("a", { href: `#/advisor/${c.id}`, text: c.name }))),
    h("p", { class: "footnote", style: "text-align:left;margin-left:0", text: "Calculations only, not investment, tax or legal advice. Inputs stay in this browser tab and are erased when it closes." })));
}

function calcView(calc) {
  S.advisor[calc.id] ||= blankInputs(calc);
  const vals = S.advisor[calc.id];
  const errs = {};
  const out = h("div", { style: "display:contents" });

  const fieldEl = (f) => {
    const id = "f-" + f.id;
    let control;
    const changed = () => { vals[f.id] = control.value; schedule(update); };
    if (fieldKind.isChoice(f)) {
      control = h("select", { id, onchange: changed }, (f.options || []).map((o) =>
        h("option", { value: Format.plain(o.value), selected: Format.plain(o.value) === String(vals[f.id]).trim(), text: o.label })));
    } else if (fieldKind.isSeries(f)) {
      control = h("textarea", { id, placeholder: f.example, oninput: changed, spellcheck: "false" });
      control.value = vals[f.id] ?? "";
    } else {
      control = h("input", { type: "text", id, inputmode: "decimal", autocomplete: "off", placeholder: f.example, value: vals[f.id] ?? "", oninput: changed });
    }
    errs[f.id] = h("div", { class: "err" });
    const pre = f.unit === "$" ? "$" : null;
    const post = f.unit === "%" ? "%" : f.unit === "years" ? "yrs" : null;
    return h("div", { class: "field" + (fieldKind.isSeries(f) ? " series" : "") },
      h("label", { for: id, text: f.label }),
      h("div", { class: "inwrap" }, pre, control, post),
      h("div", { class: "hint", text: f.hint + (fieldKind.isSeries(f) ? " Separate values with ; or new lines." : "") }),
      errs[f.id]);
  };

  const fieldsPanel = h("div", { class: "panel" }, h("h2", { text: "Inputs" }), h("div", { class: "fields" }, calc.fields.map(fieldEl)));

  function update() {
    destroyCharts();
    const ev = S.engine.evaluate(calc, vals);
    for (const f of calc.fields) {
      const typed = String(vals[f.id] ?? "").trim() !== "";
      errs[f.id].textContent = typed && ev.fieldErrors[f.id] ? ev.fieldErrors[f.id] : "";
    }
    const complete = Engine.isComplete(ev);
    const missing = calc.fields.filter((f) => ev.fieldErrors[f.id] && !String(vals[f.id] ?? "").trim());
    const kids = [];
    if (ev.ruleErrors.length) kids.push(h("div", { class: "rules" }, ev.ruleErrors.map((r) => h("div", { text: r }))));
    kids.push(h("div", { class: "panel" }, h("h2", { text: "Results" }),
      missing.length ? h("p", { class: "muted", style: "margin-top:0", text: `Fill in: ${missing.map((f) => f.label).join(", ")}. Or use Sample numbers.` }) : null,
      h("div", { class: "results" }, calc.outputs.map((o) => {
        const r = ev.outputs.find((x) => x.id === o.id);
        return h("div", { class: "result" }, h("span", { text: o.label }),
          r?.error ? h("span", { class: "e", text: r.error }) : h("span", { class: "v num", text: Format.value(r?.value ?? null, o.format) }));
      }))));
    if (complete && ev.table) kids.push(projectionCard(ev.table));
    kids.push(detailsCard(calc));
    out.replaceChildren();
    append(out, kids);
    mountCharts(out);
  }

  const resultsText = () => {
    const ev = S.engine.evaluate(calc, vals);
    return [calc.name, ...calc.fields.map((f) => `${f.label}: ${vals[f.id] ?? ""}`), "",
      ...calc.outputs.map((o) => { const r = ev.outputs.find((x) => x.id === o.id); return `${o.label}: ${r?.error ?? Format.value(r?.value ?? null, o.format)}`; })].join("\n");
  };
  const refill = () => { for (const f of calc.fields) { const el = document.getElementById("f-" + f.id); if (el) el.value = vals[f.id] ?? ""; } schedule(update); };

  const view = h("div", { style: "display:contents" },
    printHead("Calculation", calc.name),
    h("div", { class: "calc-head" },
      h("h1", {}, calc.name, calc.acronym ? h("span", { class: "pill", text: calc.acronym }) : null),
      h("div", { class: "muted", style: "font-size:13px", text: calc.category }),
      h("p", { class: "summary", text: calc.summary }),
      h("div", { class: "math", text: calc.math })),
    h("div", { class: "toolbar" },
      h("button", { class: "btn", text: "Sample numbers", title: "Fill in illustrative sample numbers (not a client's)", onclick: () => { S.advisor[calc.id] = Object.assign(vals, exampleInputs(calc)); refill(); } }),
      h("button", { class: "btn", text: "Clear", onclick: () => { Object.assign(vals, blankInputs(calc)); refill(); } }),
      h("button", { class: "btn", text: "Copy results", onclick: () => copy(resultsText(), "Copied results.") }),
      h("button", { class: "btn", text: "Copy Excel grid", title: "Inputs and live formulas to paste into Excel at A1", onclick: () => copy(S.engine.excelGrid(calc, vals), "Copied grid. Paste at A1 in Excel.") }),
      h("button", { class: "btn", text: "Print / PDF", onclick: () => window.print() })),
    usesTaxTable(calc) ? taxBanner() : null,
    fieldsPanel,
    out);
  update();
  return advisorShell(calc.id, view);
}

function projectionCard(table) {
  const cols = table.spec.columns, rows = table.rows;
  const palette = [cssVar("--accent"), cssVar("--bond"), cssVar("--warn"), cssVar("--muted")];
  const isBand = cols.length === 4 && /10th/.test(cols[1].label);
  const datasets = table.spec.chartColumns.map((ci, k) => ({
    label: cols[ci].label, data: rows.map((r) => ({ x: r[0], y: r[ci] })),
    borderColor: isBand ? (k === 1 ? palette[0] : hexA(palette[0], 0.5)) : palette[k % palette.length],
    borderWidth: isBand && k !== 1 ? 1.5 : 2.2, borderDash: isBand && k !== 1 ? [4, 3] : undefined,
  }));
  return h("div", { class: "chartcard" }, h("h3", { text: "Projection" }),
    chart("line", { datasets }, { xType: "linear", xTitle: cols[0].label }),
    h("details", { class: "how", style: "margin-top:12px", open: rows.length <= 12 }, h("summary", { text: `Year-by-year table (${rows.length} rows)` }),
      h("div", { class: "tablewrap" }, h("table", { class: "proj" },
        h("thead", {}, h("tr", {}, cols.map((c) => h("th", { text: c.label })))),
        h("tbody", {}, rows.map((r) => h("tr", {}, r.map((v, i) => h("td", { class: "n", text: Format.value(v, cols[i].format) }))))))),
      h("button", { class: "linkbtn no-print", style: "margin-top:8px", text: "Copy table",
        onclick: () => copy([cols.map((c) => c.label).join("\t"), ...rows.map((r) => r.map((v) => Format.plain(v, 2).replaceAll(",", "")).join("\t"))].join("\n"), "Copied table.") })));
}

function detailsCard(calc) {
  const formulas = calc.outputs.map((o) => [o.label, S.engine.excelFormula(calc, o)]).filter((x) => x[1]);
  return h("div", { class: "panel" }, h("h2", { text: "Details" }), h("dl", { class: "details" },
    h("dt", { text: "Assumptions" }), h("dd", { text: calc.assumptions }),
    h("dt", { text: "How to read it" }), h("dd", { text: calc.interpretation }),
    formulas.length ? [h("dt", { text: "Excel" }), h("dd", {}, h("div", { text: calc.excelNotes, style: "margin-bottom:6px" }),
      formulas.map(([label, f]) => h("div", { style: "margin:3px 0" }, `${label}: `, h("code", { text: f }))))] : null,
    calc.sources.length ? [h("dt", { text: "Sources" }), h("dd", {}, calc.sources.map((s) =>
      h("div", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", text: s.title }))))] : null));
}

// ---------------------------------------------------------------------------
// Scientific calculator

function calcPage() {
  const C = S.calc;
  const tape = h("div", { class: "tape", "aria-live": "polite" });
  const vars = h("div", { class: "vars" });
  const field = h("input", { type: "text", placeholder: "e.g. 1.07^10, x = 250000 * 0.04, sqrt(2)", autocomplete: "off", spellcheck: "false", "aria-label": "Expression" });
  const degBtn = h("button", { class: "btn" });

  const paint = () => {
    tape.replaceChildren(...(C.tape.length ? C.tape.map((l) => h("div", { class: "line" + (l.error ? " bad" : ""), title: l.error ? "" : "Click to use this result",
      onclick: () => { if (!l.error) { insert(Scientific.display(l.value).replaceAll(",", "").replace("−", "-")); } } },
    h("span", { class: "expr", text: l.expr }), h("span", { class: "res", text: l.error ?? ((l.name ? `${l.name} = ` : "") + Scientific.display(l.value)) })))
      : [h("p", { class: "muted", text: "Type an expression and press Enter. Results stay in this tab only." })]));
    tape.scrollTop = tape.scrollHeight;
    const entries = Object.entries(C.vars);
    vars.replaceChildren(...(entries.length ? entries.map(([k, v]) => h("div", {}, h("span", { text: k }), h("span", { text: Scientific.display(v) })))
      : [h("p", { class: "muted", style: "margin:0", text: "Assign with x = 5." })]));
    if (C.ans !== null) vars.append(h("div", {}, h("span", { text: "ans" }), h("span", { text: Scientific.display(C.ans) })));
    degBtn.textContent = C.degrees ? "Angles: degrees" : "Angles: radians";
  };
  const run = () => {
    const expr = field.value.trim();
    if (!expr) return;
    try {
      const r = Scientific.evaluate(expr, C.vars, C.ans, C.degrees, S.engine.tax);
      if (r.name) C.vars[r.name] = r.value;
      C.ans = r.value;
      C.tape.push({ expr, value: r.value, name: r.name });
      field.value = "";
    } catch (e) {
      C.tape.push({ expr, error: e.message });
    }
    paint();
  };
  const insert = (s) => {
    const a = field.selectionStart ?? field.value.length, b = field.selectionEnd ?? a;
    field.value = field.value.slice(0, a) + s + field.value.slice(b);
    const pos = a + s.length - (s.endsWith("()") ? 1 : 0);
    field.focus(); field.setSelectionRange(pos, pos);
  };
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); run(); }
    if (e.key === "ArrowUp" && !field.value) { const last = [...C.tape].reverse().find((l) => l.expr); if (last) field.value = last.expr; }
  });
  degBtn.addEventListener("click", () => { C.degrees = !C.degrees; paint(); });
  const keys = ["(", ")", "^", "sqrt()", "ln()", "log()", "sin()", "cos()", "tan()", "pi", "e", "ans",
    "fact()", "ncr(,)", "mod(,)", "round(,)", "abs()", "exp()"];
  paint();
  setTimeout(() => field.focus(), 0);
  return h("div", { class: "calcpage" },
    h("h1", { text: "Calculator" }),
    h("div", {}, tape,
      h("div", { class: "calcinput" }, field, h("button", { class: "btn primary", text: "=", onclick: run })),
      h("div", { class: "keys" }, keys.map((k) => h("button", { text: k.replace("(,)", "( , )"), onclick: () => insert(k.replace("(,)", "()")) }))),
      h("div", { class: "toolbar", style: "margin-top:10px" }, degBtn,
        h("button", { class: "btn", text: "Clear tape", onclick: () => { C.tape = []; C.vars = {}; C.ans = null; paint(); } }))),
    h("div", { class: "side" },
      h("div", { class: "panel" }, h("h3", { text: "Variables" }), vars),
      h("div", { class: "panel" }, h("h3", { text: "Functions" }), h("div", { class: "funclist", text:
        "+ − × ÷ ^ ( ) · sqrt cbrt ln log log2 exp abs floor ceil round mod fact ncr npr · sin cos tan asin acos atan sinh cosh tanh · fv pv pmt nper rate · normcdf norminv tcdf tinv · incometax(income, status) margrate stddeduction" }))));
}

// ---------------------------------------------------------------------------
// Router

function route() {
  destroyCharts();
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const mode = parts[0] || "client";
  document.querySelectorAll(".modes a").forEach((a) => a.classList.toggle("active", a.dataset.mode === mode));
  let view, title = "Wealth Desk";
  if (mode === "advisor") {
    const calc = parts[1] ? S.engine.calculator(decodeURIComponent(parts[1])) : null;
    view = calc ? calcView(calc) : advisorHome();
    if (calc) title = `${calc.name} · Wealth Desk`;
  } else if (mode === "calc") {
    view = calcPage(); title = "Calculator · Wealth Desk";
  } else {
    const tool = TOOLS.find((t) => t.id === parts[1]);
    if (tool) {
      title = `${tool.title} · Wealth Desk`;
      view = { growth: growthTool, retirement: retirementTool, risk: riskTool, decisions: decisionsTool, taxes: taxesTool }[tool.id](tool);
    } else view = clientHome();
  }
  document.title = title;
  app.replaceChildren(view);
  mountCharts(app);
  window.scrollTo(0, 0);
}

async function boot() {
  try {
    const [catalog, tax] = await Promise.all(["data/catalog.json", "data/taxdata.json"].map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${u}: ${r.status}`);
      return r.json();
    }));
    const taxData = new TaxData(tax);
    S.engine = new Engine(catalog, taxData);
  } catch (e) {
    app.replaceChildren(h("p", { class: "loading", text: `Couldn't load the calculator data (${e.message}).` }));
    return;
  }
  const sel = document.getElementById("taxYear");
  for (const y of S.engine.taxData.years) sel.append(h("option", { value: y, selected: y === S.engine.tax.taxYear, text: y }));
  sel.addEventListener("change", () => { S.engine.selectTaxYear(Number(sel.value)); route(); toast(`Using ${sel.value} IRS figures.`); });
  document.getElementById("printBtn").addEventListener("click", () => window.print());
  document.getElementById("clearBtn").addEventListener("click", () => {
    S.client = {}; S.advisor = {}; S.calc = { tape: [], vars: {}, ans: null, degrees: false };
    route(); toast("Cleared everything typed in this tab.");
  });
  // Charts appear once Chart.js finishes loading (it's deferred).
  if (!window.Chart) document.querySelector('script[src*="chart"]')?.addEventListener("load", () => route());
  window.addEventListener("hashchange", route);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", route);
  route();
}
boot();
