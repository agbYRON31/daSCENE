// Wealth Desk for the web. Mirrors the macOS app screen for screen: start screen, Advisor Mode
// (sidebar, calculators, Calculator, Markets, RoRo, session scenarios and history) and Client Mode.
// The engine (engine.js) is a line-by-line port of the app's, checked against it by web/parity.mjs.
// Calculator inputs live in memory only and are gone when the tab closes. Preferences (favorites,
// tax year, calculator mode) are kept in this browser, like the app keeps them on the Mac.
import {
  Engine, TaxData, Format, Scientific, fieldKind, usesTaxTable, exampleInputs, blankInputs, categories, search,
} from "./engine.js";
import { scenarioFileText, readScenarioFile } from "./scenario.js";
import { clientMarketSummary, marketTone } from "./client_market.js";

// ---------------------------------------------------------------------------
// Preferences (this browser only) and session (memory only)

const PREF_KEY = "wealthdesk.prefs.v1";
const Prefs = (() => {
  const d = { favorites: [], taxYear: null, calcScientific: false, calcDegrees: true, sidebar: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") }; } catch { return d; }
})();
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(Prefs)); } catch { /* private mode */ } };

const freshSession = () => ({
  working: {}, client: {}, scenarios: [], history: [], tape: [], variables: {},
  compare: false, taxTab: 0, roroTab: 0, roroBucket: "ALL",
});
let S = freshSession();
let engine = null;
const data = { roro: undefined, meta: null, markets: undefined };
let searchText = "";

const app = document.getElementById("app");
let charts = [];
let current = null;          // the page being shown: { title, subtitle, actions(), ... }

// ---------------------------------------------------------------------------
// DOM helpers

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
  return add(el, kids);
}
function add(el, kids) {
  for (const k of [kids].flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
function fill(el, ...kids) { el.replaceChildren(); return add(el, kids); }

// SF Symbols stand-ins (24×24 strokes).
const ICONS = {
  house: "M3 11l9-7 9 7|M5 10v10h5v-6h4v6h5V10",
  gauge: "M4 18a9 9 0 1116 0|M12 14l4-5|M12 14m-1.5 0a1.5 1.5 0 103 0 1.5 1.5 0 10-3 0",
  chart: "M3 20h18|M4 16l5-6 4 3 7-8|M17 5h3v3",
  plusminus: "M12 3a9 9 0 100 18 9 9 0 000-18z|M12 7.5v5|M9.5 10h5|M9.5 15.5h5",
  tray: "M3 13l3-8h12l3 8|M3 13v6h18v-6|M3 13h5l1 3h6l1-3h5",
  clock: "M12 3a9 9 0 100 18 9 9 0 000-18z|M12 7v5l3 2|M3 5l2 2",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  wand: "M4 20L15 9|M14 4v3|M19 9h-3|M17.5 5.5l-2 2|M20 4l-1 1",
  eraser: "M8 20h12|M4.5 15.5l9-9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 19H8z|M9 11l5 5",
  copy: "M8 8h11v12H8z|M5 16V4h11",
  table: "M3 5h18v14H3z|M3 10h18|M3 15h18|M9 5v14|M15 5v14",
  doc: "M6 3h8l4 4v14H6z|M14 3v4h4|M9 12h6|M9 15h6|M9 18h4",
  save: "M12 4v11|M7.5 11L12 15.5 16.5 11|M5 20h14",
  open: "M3 7h6l2 2h10v10H3z",
  refresh: "M20 11a8 8 0 10-2.3 5.7|M20 4v7h-7",
  share: "M12 15V3|M7.5 7.5L12 3l4.5 4.5|M5 12v8h14v-8",
  grid: "M4 4h7v7H4z|M13 4h7v7h-7z|M4 13h7v7H4z|M13 13h7v7h-7z",
  people: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z|M2.5 20a6.5 6.5 0 0113 0|M16 4.5a3.3 3.3 0 010 6.5|M17.5 14a6 6 0 014 6",
  squares: "M4 4h4v4H4z|M10 4h4v4h-4z|M16 4h4v4h-4z|M4 10h4v4H4z|M10 10h4v4h-4z|M16 10h4v4h-4z|M4 16h4v4H4z|M10 16h4v4h-4z|M16 16h4v4h-4z",
  chevron: "M9 6l6 6-6 6",
  sidebar: "M3 5h18v14H3z|M9 5v14",
  search: "M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13z|M15.5 15.5L20 20",
  lock: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z|M9.5 12l2 2 3.5-3.5",
  seal: "M12 2.5l2.2 1.6 2.7-.2.9 2.6 2.3 1.4-.6 2.6 1 2.5-2 1.8-.3 2.7-2.7.5-1.7 2.1-2.5-1-2.6.9-1.5-2.3-2.6-.8.1-2.7-1.6-2.2 1.4-2.3-.1-2.7 2.6-.9 1.4-2.3 2.6.6z|M8.5 12l2.5 2.5 4.5-4.5",
  info: "M12 3a9 9 0 100 18 9 9 0 000-18z|M12 11v6|M12 7.5v.5",
  warn: "M12 3l10 18H2z|M12 10v5|M12 18v.5",
  trash: "M4 7h16|M9 7V4h6v3|M6 7l1 13h10l1-13",
  growth: "M3 17l6-6 4 4 8-8|M14 7h7v7",
  walk: "M13 4.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z|M10 22l2-7 3 3v6|M8 12l2-5 4 1 2 4 3 1|M12 15l-1-4",
  shield: "M12 3l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z|M12 3v19",
  branch: "M6 3v12|M18 9a3 3 0 100-6 3 3 0 000 6z|M6 21a3 3 0 100-6 3 3 0 000 6z|M18 9c0 6-12 3-12 9",
  percent: "M19 5L5 19|M6.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5z|M17.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  wifi: "M2 9a15 15 0 0120 0|M5 12.5a10 10 0 0114 0|M8.5 16a5 5 0 017 0|M12 19.5v.5",
};
function icon(name, cls = "") {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "i " + cls); s.setAttribute("aria-hidden", "true");
  for (const d of (ICONS[name] || "").split("|")) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.append(p); }
  return s;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("show"), 2500);
}
async function copy(text, msg = "Copied to clipboard.") {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { toast("Couldn't copy: the browser blocked clipboard access."); }
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const timeShort = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const prettyDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
const blank = (v) => !String(v ?? "").trim();
let timer = 0;
const schedule = (fn, ms = 16) => { clearTimeout(timer); timer = setTimeout(fn, ms); };

function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function modal(title, body, buttons) {
  const back = h("div", { class: "modal-back" });
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("h2", { text: title }), body,
    h("div", { class: "actions" }, buttons.map((b) => h("button", { class: "btn" + (b.primary ? " primary" : ""), text: b.label,
      onclick: async () => { if ((await b.run?.()) !== false) close(); } }))));
  back.append(box);
  document.body.append(back);
  setTimeout(() => box.querySelector("input, button.primary")?.focus(), 0);
  return close;
}

// ---------------------------------------------------------------------------
// Charts (Chart.js)

function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }
const linesPlugin = {
  id: "wdlines",
  afterDatasetsDraw(chart, _a, opts) {
    const { ctx, chartArea: A, scales } = chart;
    ctx.save();
    for (const l of opts?.y || []) {
      const y = scales.y.getPixelForValue(l.value);
      ctx.strokeStyle = l.color; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(A.left, y); ctx.lineTo(A.right, y); ctx.stroke();
    }
    for (const l of opts?.x || []) {
      const x = scales.x.getPixelForValue(l.value);
      if (x < A.left || x > A.right) continue;
      ctx.strokeStyle = cssVar("--secondary"); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, A.top); ctx.lineTo(x, A.bottom); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = cssVar("--secondary"); ctx.font = "12px " + cssVar("--font");
      ctx.fillText(l.label || "", x + 4, A.top + 12);
    }
    ctx.restore();
  },
};
const rgba = (hex, a) => {
  const m = String(hex).match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
/** A canvas whose chart is created once the node is in the document (mountCharts). */
function chart(type, chartData, o = {}) {
  const canvas = h("canvas", { role: "img", "aria-label": o.label || "Chart" });
  const box = h("div", { class: "chartbox " + (o.size || "") }, canvas);
  box._make = () => {
    if (!window.Chart) return;
    const grid = cssVar("--fill-2"), muted = cssVar("--secondary");
    const money = { color: muted, callback: (v) => Format.compact(v) };
    const yTicks = o.yTicks || (o.money === false ? { color: muted } : money);
    const horizontal = o.indexAxis === "y";
    charts.push(new window.Chart(canvas, {
      type, data: chartData, plugins: [linesPlugin],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, indexAxis: o.indexAxis,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: o.legend !== false, labels: { color: muted, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: o.tooltip || ((c) => `${c.dataset.label}: ${Format.currency(horizontal ? c.parsed.x : c.parsed.y)}`) } },
          wdlines: o.lines || {},
        },
        elements: { point: { radius: 0, hitRadius: 6 } },
        scales: horizontal ? {
          x: { type: "linear", stacked: o.stacked, grid: { color: grid }, ticks: money, beginAtZero: true },
          y: { stacked: o.stacked, grid: { display: false }, ticks: { color: muted } },
        } : {
          x: {
            type: o.xType || "category", stacked: o.stacked, grid: { color: grid },
            ticks: { color: muted, precision: 0, autoSkip: true, maxTicksLimit: o.maxXTicks || 12, maxRotation: 0 },
            title: o.xTitle ? { display: true, text: o.xTitle, color: muted } : undefined,
          },
          y: { stacked: o.stacked, grid: { color: grid }, ticks: yTicks, beginAtZero: o.zero !== false, min: o.yMin, max: o.yMax },
        },
      },
    }));
  };
  return box;
}
function mountCharts(root) { root.querySelectorAll(".chartbox").forEach((b) => b._make && b._make()); }

function spark(values, color) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return h("span");
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 90},${22 - ((x - lo) / span) * 20}`).join(" ");
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 90 24"); s.setAttribute("width", "90"); s.setAttribute("height", "24"); s.setAttribute("class", "spark");
  const p = document.createElementNS(NS, "polyline");
  p.setAttribute("points", pts); p.setAttribute("fill", "none"); p.setAttribute("stroke", color || cssVar("--accent")); p.setAttribute("stroke-width", "1.2");
  s.append(p);
  return s;
}

// ---------------------------------------------------------------------------
// Window chrome: toolbar, mode switch, sidebar

const tbtn = (ic, label, run, o = {}) => h("button", {
  class: "tbtn" + (o.on ? " on" : ""), title: o.help || label, "aria-label": label, disabled: o.disabled, onclick: run,
}, icon(ic, o.on ? "fill" : ""), h("span", { text: label }));

function menuButton(ic, label, items, help) {
  const wrap = h("div", { class: "menu-wrap" });
  const btn = tbtn(ic, label, (e) => {
    e.stopPropagation();
    const open = wrap.querySelector(".menu");
    document.querySelectorAll(".menu").forEach((m) => m.remove());
    if (open) return;
    const m = h("div", { class: "menu", role: "menu" }, items.map((it) => it === "-" ? h("hr") :
      h("button", { role: "menuitem", text: it.label, onclick: () => { m.remove(); it.run(); } })));
    wrap.append(m);
  }, { help });
  wrap.append(btn);
  return wrap;
}
document.addEventListener("click", () => document.querySelectorAll(".menu").forEach((m) => m.remove()));

function modeSwitch(mode) {
  return h("div", { class: "seg", role: "group", "aria-label": "Mode", title: "Advisor Mode: the full library with formulas and methodology. Client Mode: simple, visual tools." },
    h("a", { href: "#/advisor", class: mode === "advisor" ? "on" : null, text: "Advisor" }),
    h("a", { href: "#/client", class: mode === "client" ? "on" : null, text: "Client" }));
}

const shell = { split: null, toolbar: null, detail: null };
function refreshToolbar() {
  if (!current || !shell.toolbar) return;
  const t = shell.toolbar;
  fill(t,
    current.mode === "advisor" ? h("button", { class: "iconbtn", title: "Show or hide the sidebar", "aria-label": "Toggle sidebar", onclick: toggleSidebar }, icon("sidebar")) : null,
    current.leading ? current.leading() : null,
    current.mode ? modeSwitch(current.mode) : null,
    h("div", { class: "tb-title" }, h("strong", { text: current.title }), current.subtitle ? h("span", { text: current.subtitle }) : null),
    h("div", { class: "tb-spacer" }),
    h("div", { class: "tb-actions" }, current.actions ? current.actions() : []));
  document.title = current.title === "Wealth Desk" ? "Wealth Desk" : `${current.title} · Wealth Desk`;
}
function toggleSidebar() {
  if (matchMedia("(max-width: 760px)").matches) { shell.split.classList.toggle("mobile-open"); return; }
  Prefs.sidebar = !Prefs.sidebar; savePrefs();
  shell.split.classList.toggle("collapsed", !Prefs.sidebar);
}

const SIDE = [
  ["home", "Home", "house"], ["roro", "RoRo Composite", "gauge"], ["markets", "Markets", "chart"],
  ["calculator", "Calculator", "plusminus"], ["scenarios", "Session scenarios", "tray"], ["history", "Session history", "clock"],
];
function sidebar(selected) {
  const list = h("div", { class: "sb-list", role: "list" });
  const row = (c) => h("a", { class: "sb-row" + (selected === c.id ? " sel" : ""), href: `#/advisor/${c.id}`, title: c.summary },
    h("span", { class: "grow", text: c.name }), c.acronym ? h("span", { class: "acr", text: c.acronym }) : null);
  const paint = () => {
    const q = searchText.trim();
    if (q) {
      const hits = search(q, engine.calculators);
      fill(list, h("div", { class: "sb-sec", text: "Results" }), hits.length ? hits.map(row) : h("div", { class: "sb-row secondary", text: "No matches" }));
      return;
    }
    const favs = Prefs.favorites.map((id) => engine.calculator(id)).filter(Boolean);
    fill(list,
      SIDE.map(([id, label, ic]) => h("a", { class: "sb-row" + (selected === id ? " sel" : ""), href: `#/advisor/${id === "home" ? "" : id}` },
        icon(ic), h("span", { class: "grow", text: label }),
        id === "scenarios" && S.scenarios.length ? h("span", { class: "badge", text: S.scenarios.length }) : null)),
      favs.length ? [h("div", { class: "sb-sec", text: "Favorites" }), favs.map(row)] : null,
      h("div", { class: "sb-sec", text: "Common" }), engine.calculators.filter((c) => c.common).map(row),
      categories(engine.calculators).map((cat) => [h("div", { class: "sb-sec", text: cat }), engine.calculators.filter((c) => c.category === cat).map(row)]));
  };
  const input = h("input", { type: "search", placeholder: "Search calculators", value: searchText, "aria-label": "Search calculators",
    oninput: () => { searchText = input.value; paint(); } });
  paint();
  const nav = h("nav", { class: "sidebar", "aria-label": "Advisor" },
    h("div", { class: "sb-search" }, h("label", {}, icon("search"), input)),
    list,
    h("div", { class: "sb-foot" }, "Inputs stay in memory for this session only. Not investment, tax or legal advice. ",
      h("button", { class: "link", style: "font-size:11px", text: "Clear session", onclick: clearSession })));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) shell.split?.classList.remove("mobile-open"); });
  return nav;
}

function clearSession() {
  S = freshSession();
  route();
  toast("Session cleared. Everything typed has been erased.");
}

function show(page, { mode, selected } = {}) {
  destroyCharts();
  current = { mode, ...page };
  shell.toolbar = h("header", { class: "tb" });
  shell.detail = h("main", { class: "detail", id: "detail" });
  shell.split = h("div", { class: "split" + (mode === "advisor" ? (Prefs.sidebar ? "" : " collapsed") : " nosidebar") },
    mode === "advisor" ? sidebar(selected) : null, shell.detail);
  add(shell.detail, page.body);
  fill(app, h("div", { class: "win" }, shell.toolbar, shell.split));
  refreshToolbar();
  mountCharts(shell.detail);
  page.mounted?.();
  shell.detail.scrollTop = 0;
}

const card = (title, trailing, ...kids) => h("section", { class: "card" },
  title || trailing ? h("div", { class: "card-head" }, title ? h("h3", { text: title }) : h("span"), trailing) : null, ...kids);
const unavailable = (ic, title, message) => h("div", { class: "unavailable" }, icon(ic), h("h2", { text: title }), h("p", { text: message }));
const printHead = (kind, title) => h("div", { class: "print-head" },
  `Wealth Desk · ${kind} · ${title} · ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · Educational illustration, not advice.`);

// ---------------------------------------------------------------------------
// Start screen

function startPage() {
  return {
    title: "Wealth Desk",
    body: h("div", { class: "start" },
      h("div", {},
        h("div", { class: "eyebrow", text: "WEALTH DESK" }),
        h("h1", { text: "See how financial decisions play out" }),
        h("p", { class: "lede", text: "Type in any numbers and watch the results update. Nothing is filled in for you, and nothing you type is saved or sent." })),
      h("div", { class: "modecards" },
        h("a", { class: "modecard", href: "#/client" }, icon("people"), h("h2", { text: "Client Mode" }),
          h("p", { text: "Six plain-language tools with sliders and charts: growth, retirement, risk, decisions, taxes and inflation, and market conditions." }),
          h("span", { class: "go" }, "Open Client Mode", icon("chevron"))),
        h("a", { class: "modecard", href: "#/advisor" }, icon("squares"), h("h2", { text: "Advisor Mode" }),
          h("p", { text: `The full workspace: ${engine.calculators.length} calculators with formulas and methodology, market data and the RoRo Composite.` }),
          h("span", { class: "go" }, "Open Advisor Mode", icon("chevron")))),
      h("div", {},
        h("div", { class: "privacy" }, icon("lock"), "This session lives in memory only and is cleared when you close the tab. Saving a scenario or a PDF happens only when you choose to."),
        h("p", { class: "legal", text: "Educational calculations and hypothetical illustrations. Not investment, tax or legal advice. Wealth Desk is an independent application, not affiliated with or endorsed by Morgan Stanley. Don't enter real client information unless your firm has approved this tool for that use." }))),
  };
}

// ---------------------------------------------------------------------------
// Advisor: home

function advisorHome() {
  const tile = (href, ic, title, text) => h("a", { class: "tile", href }, icon(ic), h("div", {}, h("strong", { text: title }), h("span", { text })));
  return {
    title: "Wealth Desk", subtitle: "Advisor Mode",
    body: h("div", { class: "page wide" },
      h("div", {}, h("h1", { class: "large", text: "Advisor workspace" }),
        h("p", { class: "secondary", style: "margin:6px 0 0", text: "Pick a tool. Every calculator opens blank; type your own numbers and results update as you go. Formulas, assumptions and sources are under “Details & Excel” on each one." })),
      h("div", { class: "tiles" },
        tile("#/advisor/roro", "gauge", "RoRo Composite", "Market risk conditions across 37 factors"),
        tile("#/advisor/markets", "chart", "Markets", "Treasury yield curve and a quote watchlist"),
        tile("#/advisor/calculator", "plusminus", "Calculator", "Basic and scientific, with a history tape"),
        tile("#/client", "people", "Client Mode", "Six simple, visual tools for a conversation")),
      categories(engine.calculators).map((cat) => h("div", { class: "cat" }, h("h2", { text: cat }),
        h("div", { class: "catgrid" }, engine.calculators.filter((c) => c.category === cat).map((c) =>
          h("a", { href: `#/advisor/${c.id}`, title: c.summary }, h("span", { class: "grow", text: c.name }), icon("chevron")))))),
      h("p", { class: "caption tertiary", text: "Educational calculations. Not investment, tax or legal advice. Independent application; not affiliated with or endorsed by Morgan Stanley." })),
  };
}

// ---------------------------------------------------------------------------
// Advisor: calculator

function taxBanner(onChange) {
  const t = engine.tax;
  const sel = h("select", { "aria-label": "Tax year", onchange: () => {
    Prefs.taxYear = Number(sel.value); savePrefs(); engine.selectTaxYear(Prefs.taxYear); onChange?.();
  } }, engine.taxData.years.map((y) => h("option", { value: y, selected: y === t.taxYear, text: y })));
  return h("div", { class: "taxbanner" },
    h("div", { class: "row" }, icon("seal"), "IRS figures for tax year", sel,
      h("span", { class: "secondary", text: `· verified ${prettyDate(t.verifiedOn)} against ${t.sources[0]?.title.split(" (")[0] ?? "IRS publications"}` })),
    t.notes.map((n) => h("div", { class: "row caption secondary" }, icon("info"), n)));
}

const unitSuffix = (f) => ({ "%": "%", years: "years", age: "years old" })[f.unit] ?? null;

function recordHistory(calc, inputs, ev) {
  if (!Engine.isComplete(ev)) return;
  const first = ev.outputs.find((o) => o.value !== null);
  if (!first) return;
  const last = S.history[0];
  if (last && last.calculatorID === calc.id && JSON.stringify(last.inputs) === JSON.stringify(inputs)) return;
  S.history.unshift({ calculatorID: calc.id, inputs: { ...inputs }, summary: `${first.label}: ${Format.value(first.value, first.format)}`, date: new Date() });
  S.history.length = Math.min(S.history.length, 200);
}

function calcPage(calc) {
  S.working[calc.id] ||= blankInputs(calc);
  const vals = S.working[calc.id];
  const errs = {}, hints = {}, controls = {};
  const live = h("div", { style: "display:contents" });
  let histTimer = 0;

  const field = (f) => {
    const id = "f-" + f.id;
    let c;
    const changed = () => { vals[f.id] = c.value; schedule(update, calc.projection ? 120 : 16); };
    if (fieldKind.isChoice(f)) {
      c = h("select", { id, onchange: changed }, (f.options || []).map((o) => h("option", { value: Format.plain(o.value), text: o.label })));
    } else if (fieldKind.isSeries(f)) {
      c = h("textarea", { id, rows: 2, placeholder: "e.g. " + f.example, spellcheck: "false", oninput: changed });
    } else {
      c = h("input", { type: "text", id, inputmode: "decimal", autocomplete: "off", spellcheck: "false", oninput: changed });
    }
    c.value = vals[f.id] ?? "";
    controls[f.id] = c;
    hints[f.id] = h("div", { class: "hint", text: f.hint });
    errs[f.id] = h("div", { class: "err hidden" });
    const line = fieldKind.isChoice(f) || fieldKind.isSeries(f) ? c
      : h("div", { class: "line" }, h("span", { class: "pre", text: f.unit === "$" ? "$" : "" }), c, unitSuffix(f) ? h("span", { class: "suf", text: unitSuffix(f) }) : null);
    return [h("label", { for: id, text: f.label }), h("div", { class: "ctrl" }, line, hints[f.id], errs[f.id])];
  };

  function note(o) {
    if (o.value !== null && Number.isNaN(o.value) && o.label.toLowerCase().includes("bracket")) return "Top bracket: no upper limit.";
    if (o.format === "age" && o.value !== null && o.value < 0) return "Money lasts through the plan.";
    return o.error;
  }

  function update() {
    destroyCharts();
    const ev = engine.evaluate(calc, vals);
    for (const f of calc.fields) {
      const show = ev.fieldErrors[f.id] && !blank(vals[f.id]);
      errs[f.id].textContent = show ? ev.fieldErrors[f.id] : "";
      errs[f.id].classList.toggle("hidden", !show);
      hints[f.id].classList.toggle("hidden", !!show);
    }
    const complete = Engine.isComplete(ev);
    fill(live,
      ev.ruleErrors.length ? h("div", { class: "rules" }, ev.ruleErrors.map((r) => h("div", {}, icon("warn"), r))) : null,
      card("Results", null, complete
        ? [h("div", { class: "rtiles" }, ev.outputs.map((o) => {
            const neg = (o.value ?? 0) < 0 && o.format !== "age";
            return h("div", { class: "rtile", title: "Click to copy", tabindex: "0", onclick: () => {
              if (o.value === null || Number.isNaN(o.value)) return;
              copy(Format.value(o.value, o.format), `Copied ${o.label.toLowerCase()}.`);
            } }, h("div", { class: "lbl", text: o.label }), h("div", { class: "val" + (neg ? " neg" : ""), text: Format.value(o.value, o.format) }),
            note(o) ? h("div", { class: "nt", text: note(o) }) : null);
          })), h("div", { class: "caption tertiary", text: "Click a result to copy it." })]
        : h("div", { class: "secondary", text: "Enter your numbers above. Results appear as soon as every field is filled in." })),
      complete && ev.table ? projectionCard(calc, ev.table) : null,
      detailsCard(calc));
    mountCharts(live);
    clearTimeout(histTimer);
    histTimer = setTimeout(() => recordHistory(calc, vals, ev), 2000);
  }

  const refill = () => { for (const f of calc.fields) controls[f.id].value = vals[f.id] ?? ""; update(); };
  const resultsText = () => {
    const ev = engine.evaluate(calc, vals);
    if (!Engine.isComplete(ev)) return null;
    return [calc.name, ...calc.fields.map((f) => `${f.label}: ${vals[f.id] ?? ""}${fieldKind.isPercent(f) ? "%" : ""}`), "",
      ...ev.outputs.map((o) => `${o.label}: ${Format.value(o.value, o.format)}`)].join("\n");
  };
  const fav = () => Prefs.favorites.includes(calc.id);

  return {
    title: calc.name, subtitle: calc.category,
    actions: () => [
      tbtn("wand", "Sample numbers", () => { Object.assign(vals, exampleInputs(calc)); refill(); }, { help: "Fill in illustrative sample numbers (not a client's)" }),
      tbtn("eraser", "Clear", () => { Object.assign(vals, blankInputs(calc)); refill(); }, { help: "Clear all inputs" }),
      tbtn("copy", "Copy results", () => { const t = resultsText(); t ? copy(t) : toast("Nothing to copy yet. Finish the inputs first."); }, { help: "Copy the results as text" }),
      tbtn("table", "Copy Excel grid", () => copy(engine.excelGrid(calc, vals), "Copied grid. Paste at A1 in Excel."), { help: "Copy inputs and live formulas to paste into Excel at A1" }),
      tbtn("doc", "PDF report", () => { Engine.isComplete(engine.evaluate(calc, vals)) ? window.print() : toast("Nothing to report yet. Finish the inputs first."); },
        { help: "Print, or choose Save as PDF in the print dialog" }),
      menuButton("save", "Save", [
        { label: "Keep for This Session", run: () => { S.scenarios.unshift({ name: calc.name, calculatorID: calc.id, inputs: { ...vals }, created: new Date() }); toast("Kept for this session. It is not saved anywhere."); route(); } },
        { label: "Save Scenario to a File…", run: () => saveScenarioDialog(calc.id, calc.name, { ...vals }) },
        "-",
        { label: "Open Scenario File…", run: openScenarioFile },
      ], "Inputs are not saved automatically. Keep them for this session, or save them to a file you choose."),
      tbtn("star", "Favorite", () => {
        Prefs.favorites = fav() ? Prefs.favorites.filter((x) => x !== calc.id) : [...Prefs.favorites, calc.id];
        savePrefs(); route();
      }, { on: fav(), help: fav() ? "Remove from favorites" : "Add to favorites" }),
    ],
    body: h("div", { class: "page" },
      printHead("Advisor worksheet", calc.name),
      h("div", { class: "calc-head" },
        h("h1", {}, calc.name, calc.acronym ? h("span", { class: "pill", text: calc.acronym }) : null),
        h("p", { text: calc.summary }),
        h("div", { class: "math", text: calc.math })),
      usesTaxTable(calc) ? taxBanner(update) : null,
      card("Inputs", null, h("div", { class: "inputs-grid" }, calc.fields.map(field))),
      live),
    mounted: update,
  };
}

function projectionCard(calc, table) {
  const cols = table.spec.columns, rows = table.rows;
  const colors = [cssVar("--orange"), cssVar("--accent"), cssVar("--blue")];
  const tsv = () => [cols.map((c) => c.label).join("\t"), ...rows.map((r) => r.map((v) => Format.plain(v, 2)).join("\t"))].join("\n");
  return card(calc.projection === "montecarlo" ? "Balance range across simulations" : "Year by year",
    h("button", { class: "link no-print", text: "Copy table", onclick: () => copy(tsv(), "Copied table. Paste into Excel.") }),
    chart("line", { datasets: table.spec.chartColumns.map((ci, k) => ({
      label: cols[ci].label, data: rows.map((r) => ({ x: r[0], y: r[ci] })), borderColor: colors[k % 3], backgroundColor: colors[k % 3], borderWidth: 2, tension: 0.25,
    })) }, { xType: "linear", xTitle: cols[0].label, zero: false }),
    h("details", { class: "disc" }, h("summary", { text: `Show table (${rows.length} rows)` }),
      h("div", { class: "disc-body tablewrap" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, cols.map((c) => h("th", { text: c.label })))),
        h("tbody", {}, rows.map((r) => h("tr", {}, r.map((v, i) => h("td", { text: Format.value(v, cols[i].format) })))))))));
}

function detailsCard(calc) {
  return card("Details & Excel", null, h("details", { class: "disc details" },
    h("summary", { text: "Assumptions, interpretation, Excel formulas and sources" }),
    h("div", { class: "disc-body", style: "display:flex;flex-direction:column;gap:14px" },
      h("div", {}, h("h4", { text: "Assumptions" }), h("p", { text: calc.assumptions })),
      h("div", {}, h("h4", { text: "How to read it" }), h("p", { text: calc.interpretation })),
      h("div", { style: "display:flex;flex-direction:column;gap:6px" }, h("h4", { text: "Excel" }),
        h("div", { class: "xl" }, calc.outputs.map((o) => [h("span", { class: "secondary", text: o.label }),
          h("code", { text: engine.excelFormula(calc, o) ?? "No single-cell formula" })])),
        h("p", { class: "caption", text: "Formulas assume the copied grid is pasted at A1 (inputs in column B, starting at row 2)." }),
        h("p", { class: "caption", text: calc.excelNotes })),
      calc.sources.length ? h("div", {}, h("h4", { text: "Sources" }), calc.sources.map((s) =>
        h("div", {}, h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", text: s.title })))) : null)));
}

// ---------------------------------------------------------------------------
// Scenario files: same format and encryption as the Mac app (AES-256-GCM, PBKDF2-HMAC-SHA256)

function saveScenarioDialog(calculatorID, title, inputs) {
  const name = h("input", { type: "text", value: title, "aria-label": "Scenario name" });
  const protect = h("input", { type: "checkbox" });
  const pw = h("input", { type: "password", placeholder: "Password", autocomplete: "new-password", disabled: true });
  const pw2 = h("input", { type: "password", placeholder: "Confirm password", autocomplete: "new-password", disabled: true });
  protect.addEventListener("change", () => { pw.disabled = pw2.disabled = !protect.checked; if (protect.checked) pw.focus(); });
  modal("Save scenario to a file", [
    h("p", { text: "This downloads the numbers currently in this calculator to a file on your device. Wealth Desk doesn't upload or sync it, but anyone who can open the file can read it unless you set a password. Don't save real client figures unless your firm permits it." }),
    name,
    h("label", { class: "toggle" }, protect, "Protect with a password (AES-256)"),
    pw, pw2,
    h("p", { class: "caption", text: "There is no way to recover a forgotten password. Files open in the Mac app too." }),
  ], [
    { label: "Cancel" },
    { label: "Download", primary: true, run: async () => {
      if (protect.checked && (!pw.value || pw.value !== pw2.value)) { toast(pw.value ? "The passwords don't match." : "Enter a password."); return false; }
      const t = name.value.trim() || title;
      download(`${t}.wealthdesk`, await scenarioFileText(calculatorID, t, inputs, protect.checked ? pw.value : null));
      toast(protect.checked ? "Saved (password-protected)." : "Saved to your downloads.");
    } },
  ]);
}

function openScenarioFile() {
  const picker = h("input", { type: "file", accept: ".wealthdesk,.json,application/json" });
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0];
    if (!file) return;
    const text = await file.text();
    const finish = async (password) => {
      try {
        const s = await readScenarioFile(text, password);
        const calc = engine.calculator(s.calculatorID);
        if (!calc) { toast("That scenario is for a calculator this version doesn't have."); return; }
        const inputs = blankInputs(calc);
        for (const [k, v] of Object.entries(s.inputs || {})) if (k in inputs) inputs[k] = String(v);
        S.working[calc.id] = inputs;
        S.scenarios.unshift({ name: s.title, calculatorID: calc.id, inputs: { ...inputs }, created: new Date() });
        location.hash = `#/advisor/${calc.id}`;
        route();
        toast(`Opened “${s.title}” into this session.`);
      } catch (e) { toast(e.message); return false; }
    };
    let encrypted = false;
    try { encrypted = JSON.parse(text).format === "wealthdesk-scenario-encrypted"; } catch { /* reported by finish */ }
    if (!encrypted) { finish(null); return; }
    const pw = h("input", { type: "password", placeholder: "Password", autocomplete: "current-password" });
    pw.addEventListener("keydown", (e) => { if (e.key === "Enter") pw.closest(".modal").querySelector("button.primary").click(); });
    modal("This scenario is password-protected", [h("p", { text: "Enter the password used when it was saved." }), pw],
      [{ label: "Cancel" }, { label: "Open", primary: true, run: () => finish(pw.value) }]);
  });
  picker.click();
}

// ---------------------------------------------------------------------------
// Advisor: session scenarios and history

function scenariosPage() {
  const open = (s) => { S.working[s.calculatorID] = { ...s.inputs }; location.hash = `#/advisor/${s.calculatorID}`; };
  return {
    title: "Session scenarios", subtitle: "In memory only · cleared when you close the tab",
    actions: () => [tbtn("open", "Open Scenario File…", openScenarioFile)],
    body: S.scenarios.length ? h("div", { class: "page" }, h("div", { class: "list" }, S.scenarios.map((s) => h("div", { class: "item", ondblclick: () => open(s) },
      h("div", { class: "grow" }, h("strong", { text: s.name }),
        h("div", { class: "caption secondary", text: `${engine.calculator(s.calculatorID)?.name ?? s.calculatorID} • ${timeShort(s.created)}` })),
      h("button", { class: "btn", text: "Open", onclick: () => open(s) }),
      h("button", { class: "btn", text: "Save to File…", onclick: () => saveScenarioDialog(s.calculatorID, s.name, s.inputs) }),
      h("button", { class: "iconbtn", title: "Remove from this session", "aria-label": "Remove", onclick: () => { S.scenarios = S.scenarios.filter((x) => x !== s); route(); } }, icon("trash"))))))
      : unavailable("tray", "No scenarios this session", "In any calculator choose Save ▸ Keep for This Session to hold a set of inputs here while you compare. They are not saved anywhere and disappear when you close the tab. Use Open Scenario File to load one you saved earlier."),
  };
}

function historyPage() {
  const open = (it) => { S.working[it.calculatorID] = { ...it.inputs }; location.hash = `#/advisor/${it.calculatorID}`; };
  return {
    title: "Session history", subtitle: "In memory only · cleared when you close the tab",
    actions: () => [tbtn("trash", "Clear history", () => { S.history = []; route(); }, { disabled: !S.history.length })],
    body: S.history.length ? h("div", { class: "page" }, h("div", { class: "list" }, S.history.map((it) => h("div", { class: "item", ondblclick: () => open(it) },
      h("div", { class: "grow" }, h("strong", { text: engine.calculator(it.calculatorID)?.name ?? it.calculatorID }),
        h("div", { class: "callout tnum", text: it.summary }), h("div", { class: "caption secondary", text: timeShort(it.date) })),
      h("button", { class: "btn", text: "Open", onclick: () => open(it) })))))
      : unavailable("clock", "No history this session", "Completed calculations are listed here a moment after you stop typing. The list is kept in memory only and is erased when you close the tab."),
  };
}

// ---------------------------------------------------------------------------
// Advisor: Calculator (basic / scientific with a tape)

function padPage() {
  let line = "", error = null;
  const ans = () => S.tape[0]?.result ?? null;
  const input = h("input", { type: "text", placeholder: "0", autocomplete: "off", spellcheck: "false", "aria-label": "Expression" });
  const out = h("div", { class: "out" });
  const side = h("div", { class: "pad-side" });
  const keysBox = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
  const help = h("p", { class: "caption secondary", style: "margin:0" });
  const head = h("div", { class: "pad-head" });

  const preview = () => {
    if (blank(line)) return null;
    try { return Scientific.evaluate(line, S.variables, ans(), Prefs.calcDegrees, engine.tax).value; } catch { return null; }
  };
  const paintOut = () => {
    const p = preview();
    fill(out, error ? h("span", { class: "bad", text: error })
      : p !== null ? h("span", { class: "preview", text: "= " + Scientific.display(p) })
        : h("span", { class: "callout secondary tnum", text: ans() !== null ? "ans = " + Scientific.display(ans()) : " " }));
  };
  const plain = (v) => Scientific.display(v).replaceAll(",", "").replace("−", "-");
  const paintSide = () => {
    const vars = Object.entries(S.variables);
    fill(side,
      vars.length ? card("Variables", h("button", { class: "link", text: "Clear", onclick: () => { S.variables = {}; paintSide(); } }),
        h("div", { class: "vars" }, vars.map(([k, v]) => h("div", { class: "row" }, h("span", { text: k }), h("span", { text: Scientific.display(v) }))))) : null,
      card("History", h("button", { class: "link", text: "Clear", onclick: () => { S.tape = []; paintSide(); paintOut(); } }),
        S.tape.length ? h("div", { class: "tape" }, S.tape.map((e) => h("div", { class: "row", title: "Click to insert this result",
          onclick: () => { insert(plain(e.result)); } },
        h("span", { class: "expr", text: e.expression }), h("span", { class: "res", text: (e.assigned ? `${e.assigned} = ` : "") + Scientific.display(e.result) }))))
          : h("div", { class: "callout secondary", text: "Results appear here. Click one to reuse it." })));
  };
  const setLine = (s) => { line = s; input.value = s; error = null; paintOut(); };
  const insert = (s) => {
    const a = input.selectionStart ?? line.length, b = input.selectionEnd ?? a;
    setLine(line.slice(0, a) + s + line.slice(b));
    input.focus(); input.setSelectionRange(a + s.length, a + s.length);
  };
  const evaluate = () => {
    const text = line.trim();
    if (!text) return;
    try {
      const r = Scientific.evaluate(text, S.variables, ans(), Prefs.calcDegrees, engine.tax);
      if (r.name) S.variables[r.name] = r.value;
      S.tape.unshift({ expression: text, result: r.value, assigned: r.name });
      S.tape.length = Math.min(S.tape.length, 300);
      setLine("");
      paintSide();
    } catch (e) { error = e.message; paintOut(); }
    input.focus();
  };
  const press = (k) => {
    error = null;
    switch (k.insert) {
      case "=": evaluate(); return;
      case "C": setLine(""); break;
      case "⌫": setLine(line.replace(/\s*.\s*$/u, (m) => m.trim().length > 1 ? m.trim().slice(0, -1) : "")); break;
      case "()": {
        const opens = (line.match(/\(/g) || []).length, closes = (line.match(/\)/g) || []).length;
        const last = line.trim().slice(-1);
        setLine(line + (opens > closes && /[\p{L}\p{N})]/u.test(last) ? ")" : "("));
        break;
      }
      case "±": setLine(line.startsWith("−(") && line.endsWith(")") ? line.slice(2, -1) : (line ? `−(${line})` : "−")); break;
      default:
        if (!line && k.kind === "op" && ans() !== null) line = "ans";
        setLine(line + k.insert);
    }
    input.focus();
  };
  const K = (label, insert, kind = "fn") => ({ label, insert, kind });
  const basic = [
    [K("C", "C", "action"), K("⌫", "⌫", "action"), K("( )", "()", "action"), K("÷", " ÷ ", "op")],
    [K("7", "7", "digit"), K("8", "8", "digit"), K("9", "9", "digit"), K("×", " × ", "op")],
    [K("4", "4", "digit"), K("5", "5", "digit"), K("6", "6", "digit"), K("−", " − ", "op")],
    [K("1", "1", "digit"), K("2", "2", "digit"), K("3", "3", "digit"), K("+", " + ", "op")],
    [K("±", "±", "action"), K("0", "0", "digit"), K(".", ".", "digit"), K("=", "=", "eq")],
  ];
  const sci = [
    [K("sin", "sin("), K("cos", "cos("), K("tan", "tan("), K("ln", "ln("), K("log", "log(")],
    [K("sin⁻¹", "asin("), K("cos⁻¹", "acos("), K("tan⁻¹", "atan("), K("eˣ", "exp("), K("10ˣ", "10^(")],
    [K("x²", "^2"), K("xʸ", "^"), K("√", "sqrt("), K("∛", "cbrt("), K("1/x", "1/(")],
    [K("π", "pi"), K("e", "e"), K("n!", "fact("), K("nCr", "ncr("), K("%", "/100")],
    [K("|x|", "abs("), K("mod", "mod("), K(",", ", "), K("ans", "ans"), K("EE", "*10^")],
  ];
  const keyBtn = (k) => h("button", { class: `key ${k.kind === "eq" ? "eq" : k.kind}`, text: k.label, title: k.insert.trim(), onclick: () => press(k) });
  const paintKeys = () => {
    fill(head,
      h("div", { class: "seg" }, [["Basic", false], ["Scientific", true]].map(([l, v]) => h("button", { class: Prefs.calcScientific === v ? "on" : null, text: l,
        onclick: () => { Prefs.calcScientific = v; savePrefs(); paintKeys(); current.subtitle = v ? "Scientific" : "Basic"; refreshToolbar(); } }))),
      Prefs.calcScientific ? h("div", { class: "seg", title: "Angle unit for sin, cos, tan and their inverses" }, [["Deg", true], ["Rad", false]].map(([l, v]) =>
        h("button", { class: Prefs.calcDegrees === v ? "on" : null, text: l, onclick: () => { Prefs.calcDegrees = v; savePrefs(); paintKeys(); paintOut(); } }))) : null);
    fill(keysBox,
      Prefs.calcScientific ? [h("div", { class: "keys sci" }, sci.flat().map(keyBtn)), h("hr", { style: "border:0;border-top:1px solid var(--sep);margin:2px 0;width:100%" })] : null,
      h("div", { class: "keys basic" }, basic.flat().map(keyBtn)));
    help.textContent = "Type with the keyboard or tap the keys. Enter or = evaluates; Esc clears. Use ans for the last result, or name a value with x = 5 and use it later. " +
      (Prefs.calcScientific ? "Functions: sin cos tan asin acos atan sinh cosh tanh, ln log log2 log(x, b), sqrt cbrt exp, abs round mod, fact ncr npr, pi e." : "");
  };
  input.addEventListener("input", () => { line = input.value; error = null; paintOut(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); evaluate(); }
    if (e.key === "Escape") setLine("");
  });
  paintKeys(); paintOut(); paintSide();
  return {
    title: "Calculator", subtitle: Prefs.calcScientific ? "Scientific" : "Basic",
    body: h("div", { class: "pad" },
      h("div", { class: "pad-main" }, head, h("div", { class: "display" }, input, out), keysBox, help),
      side),
    mounted: () => input.focus(),
  };
}

// ---------------------------------------------------------------------------
// Advisor: Markets (published snapshot)

async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
async function loadMarkets(force) {
  if (data.markets !== undefined && !force) return;
  try { data.markets = await loadJSON("data/markets.json"); } catch { data.markets = null; }
}
async function loadRoRo(force) {
  if (data.roro !== undefined && !force) return;
  try {
    [data.roro, data.meta] = await Promise.all([loadJSON("data/roro.json"), loadJSON("data/roro_meta.json").catch(() => null)]);
  } catch { data.roro = null; }
}

function openCalculator(id, setting) {
  const calc = engine.calculator(id);
  S.working[id] = { ...blankInputs(calc), ...(S.working[id] || {}), ...setting };
  location.hash = `#/advisor/${id}`;
}

function marketsPage() {
  const m = data.markets;
  const updated = m?.generated ? new Date(m.generated) : null;
  const bp = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 10000))} bp`;
  let curveCard;
  if (m?.curve) {
    const pts = m.curve.points, rate = (l) => pts.find((p) => p.label === l)?.rate;
    const spread = (a, b) => (rate(a) !== undefined && rate(b) !== undefined ? rate(a) - rate(b) : null);
    const spTile = (t, v) => h("div", { class: "sptile" }, h("div", { class: "callout secondary", text: t }),
      h("div", { class: "v" + (v !== null && v < 0 ? " warn" : ""), text: v === null ? "—" : bp(v) }),
      v !== null && v < 0 ? h("div", { class: "caption warn", text: "Inverted" }) : null);
    curveCard = card("Treasury yield curve", h("span", { class: "callout secondary", text: `As of ${m.curve.date}` }),
      chart("line", { labels: pts.map((p) => p.label), datasets: [{ label: "Yield", data: pts.map((p) => p.rate * 100),
        borderColor: cssVar("--accent"), backgroundColor: cssVar("--accent"), pointRadius: 3, borderWidth: 2, tension: 0.3 }] },
      { legend: false, zero: false, size: "h200", yTicks: { color: cssVar("--secondary"), callback: (v) => v.toFixed(2) + "%" }, tooltip: (c) => `${c.label}: ${c.parsed.y.toFixed(2)}%` }),
      h("div", { class: "spreads" }, spTile("10Y − 2Y", spread("10 Yr", "2 Yr")), spTile("10Y − 3M", spread("10 Yr", "3 Mo")), spTile("30Y − 10Y", spread("30 Yr", "10 Yr"))),
      h("div", { class: "ytiles" }, pts.map((p) => h("button", { class: "ytile", title: `Open Bond price with a ${p.label} yield of ${Format.percent(p.rate)}`,
        onclick: () => openCalculator("bond_price", { ytm: Format.plain(p.rate * 100, 3), years: Format.plain(p.years, 4), cpn: Format.plain(p.rate * 100, 3) }) },
      h("div", { class: "caption secondary", text: p.label }), h("div", { class: "v", text: Format.percent(p.rate) }),
      p.prior !== null ? h("div", { class: "caption tnum " + ((p.rate - p.prior) > 0 ? "down" : (p.rate - p.prior) < 0 ? "up" : "secondary"), text: bp(p.rate - p.prior) }) : null))),
      h("div", { class: "caption tertiary", text: "Click a maturity to price a bond at that yield." }),
      h("p", { class: "note", text: `Source: U.S. Department of the Treasury, daily par yield curve rates (official). Observation date ${m.curve.date}; end-of-day figures, not real-time.` }));
  } else {
    curveCard = card("Treasury yield curve", null, h("div", { class: "secondary", style: "display:flex;gap:8px;align-items:center" }, icon("wifi"),
      m === null ? "The market snapshot isn't available right now. No figures are shown rather than stale ones." : "Loading…"));
  }
  const quotes = m?.quotes || [];
  const watch = card("Watchlist", null,
    quotes.length ? h("div", {}, quotes.map((q) => {
      const ch = q.price - q.previousClose, pct = q.previousClose ? ch / q.previousClose : 0;
      const f2 = (v) => Format.plain(v, 2);
      return h("div", { class: "qrow" },
        h("div", { class: "grow" }, h("strong", { text: q.symbol }),
          h("div", { class: "caption " + (q.error ? "down" : "secondary"), text: q.error ? q.error : `${q.name} · delayed quote as of ${new Date(q.time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` })),
        q.error ? null : h("div", { class: "rng" },
          q.low52 !== null && q.high52 !== null ? h("div", { text: `52-wk ${f2(q.low52)} – ${f2(q.high52)}` }) : null,
          q.dayLow !== null && q.dayHigh !== null ? h("div", { text: `Day ${f2(q.dayLow)} – ${f2(q.dayHigh)}` }) : null),
        q.error ? null : h("button", { class: "px", title: "Open Position gain/loss at this price", onclick: () => openCalculator("position_pl", { price: Format.plain(q.price, 4) }) },
          h("div", { class: "p", text: f2(q.price) }),
          h("div", { class: "caption tnum " + (ch >= 0 ? "up" : "down"), text: `${ch >= 0 ? "+" : ""}${ch.toFixed(2)} (${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(2)}%)` })));
    })) : h("div", { class: "secondary", text: m === undefined ? "Loading…" : "No quotes in this snapshot." }),
    h("div", { class: "caption tertiary", text: "Click a price to open Position gain/loss with it filled in." }),
    h("p", { class: "note", text: "Source: Yahoo Finance chart feed (unofficial and unlicensed; quotes are delayed). On the web this is a snapshot published with the site each weekday after the close, because browsers can't reach these feeds directly; the Mac app fetches live and lets you add any symbol." }));
  return {
    title: "Markets", subtitle: updated ? `Snapshot ${updated.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "",
    actions: () => [tbtn("refresh", "Refresh", async () => { await loadMarkets(true); route(); toast("Reloaded the latest published snapshot."); }, { help: "Reload the latest published snapshot" })],
    body: h("div", { class: "page" },
      h("div", {}, h("h1", { class: "large", text: "Markets" }),
        h("p", { class: "callout secondary", style: "margin:4px 0 0", text: "Treasury yields from Treasury.gov (official, end of day). Quotes are from Yahoo Finance's unofficial feed and are delayed. The web version shows the snapshot published with this site; nothing you type is sent anywhere." })),
      curveCard, watch),
  };
}

// ---------------------------------------------------------------------------
// Advisor: RoRo Composite

const signed = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "+"}${Math.abs(v).toFixed(d)}`);
const pctS = (v) => (v === null || v === undefined ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`);
const tone = (v) => (v === null || v === undefined || Number.isNaN(v) ? "" : v >= 20 ? "pos" : v <= -20 ? "neg" : "neu");
const bandTone = (b) => (b === "OFFENSE" ? "pos" : b === "DEFENSE" ? "neg" : "neu");
function scoreBar(v, big) {
  const x = (s) => ((Math.min(Math.max(s, -100), 100) + 100) / 200) * 100;
  const bar = h("div", { class: "scorebar" + (big ? " h12" : "") },
    h("i", { style: `left:${x(-20)}%` }), h("i", { style: `left:${x(20)}%` }), h("i", { class: "zero", style: `left:${x(0)}%` }));
  if (v !== null && v !== undefined && !Number.isNaN(v)) {
    bar.append(h("b", { class: "bg-" + tone(v), style: `left:${Math.min(x(v), x(0))}%;width:max(3px, ${Math.abs(x(v) - x(0))}%)` }));
  }
  return bar;
}
const rcard = (title, note, ...kids) => h("section", { class: "card" }, h("p", { class: "cap-title", text: title }), ...kids, note ? h("p", { class: "note", text: note }) : null);

function roroStatus(m) {
  if (!m) return { label: "No data", cls: "", detail: "The RoRo data hasn't been published yet." };
  const asof = new Date(m.asof_iso + "T12:00:00"), days = (Date.now() - asof) / 864e5;
  if (m.stale?.length) return { label: "Partly cached", cls: "warn", detail: `${m.stale.length} of ${m.health.length} series came from cache or are unavailable. Data as of ${m.asof}.` };
  return days <= 4
    ? { label: "Current", cls: "up", detail: `Data as of ${m.asof} (latest published or closing values, not real-time). Scored ${m.generated} UTC.` }
    : { label: "Earlier data", cls: "warn", detail: `Data as of ${m.asof}. The daily update hasn't run since; scored ${m.generated} UTC.` };
}

function roroOverview(m) {
  const p = m.posture || {}, master = m.master || {}, band = p.band || "—";
  const hist = m.history || { dates: [] };
  return [
    h("div", { class: "row2" },
      rcard("Posture · driven by the Intermediate dial (1–3 months)", null,
        h("div", { style: "display:flex;align-items:baseline;gap:12px;flex-wrap:wrap" },
          h("span", { class: "bigband c-" + bandTone(band), text: band }),
          p.lean ? h("span", { class: "caption secondary", style: "font-weight:600", text: p.lean }) : null,
          h("span", { style: "flex:1" }), h("span", { class: "bignum", text: signed(p.value) })),
        scoreBar(p.value, true),
        h("div", { class: "callout secondary", text: `${p.status || ""} · in ${band} since ${p.since || "—"} (${p.days_in ?? 0} sessions) · ${signed(p.delta)} pts since ${p.prev_date || "last run"}` }),
        h("div", { class: "callout secondary", text: `Offense above +20, Defense below −20. ${p.to_off ?? 0} pts from the Offense line, ${p.to_def ?? 0} from the Defense line.` })),
      rcard("Master signal", "Generic model playbook for discussion. It is not a recommendation and takes no account of any person's situation.",
        h("div", { style: "font-size:21px;font-weight:700", text: master.head || "—" }),
        h("div", { class: "callout secondary", text: `${master.regime || ""} · confidence ${master.confidence || ""}` }),
        h("div", { class: "callout", text: master.action || "" }))),
    h("div", { class: "row3" }, (m.horizons || []).map((z) => rcard(`${z.label} · ${z.span}`, null,
      h("div", { style: "display:flex;align-items:baseline;justify-content:space-between" },
        h("span", { class: "bignum c-" + tone(z.value), text: signed(z.value) }), h("span", { class: "caption secondary", style: "font-weight:600", text: z.regime })),
      scoreBar(z.value),
      h("div", { class: "caption secondary", text: `${signed(z.wow)} vs. a week ago · 4-week average ${signed(z.avg4w)}` }),
      h("div", { class: "callout", text: z.plain || "" }),
      h("div", { class: "caption secondary", text: `Strongest: ${z.top?.bucket ?? "—"} (${signed(z.top?.score)}) · weakest: ${z.low?.bucket ?? "—"} (${signed(z.low?.score)})` })))),
    rcard("Six buckets", "Each bucket is the weighted average of its factor scores (−100 risk-off to +100 risk-on). See the Factors tab for every input.",
      h("div", { class: "bucketgrid" }, (m.buckets || []).map((b) => [
        h("span", { text: b.name }), scoreBar(b.score),
        h("span", { class: "tnum", style: "text-align:right;font-weight:600", text: signed(b.score) }),
        h("span", { class: "wk caption secondary tnum", style: "text-align:right", text: `${signed(b.wow)} wk` }),
        h("span", { class: "spark" }, spark(b.spark || [])),
        h("span", { class: "live caption secondary", text: `${b.factors_live}/${b.factors_total} live` })]))),
    rcard("Last 24 months", "Tactical is the raw daily composite; Intermediate and Strategic are smoothed (5- and 20-day).",
      chart("line", { labels: hist.dates, datasets: [
        ["tactical", "Tactical", rgba(cssVar("--secondary").startsWith("rgba") ? "#8e8e93" : cssVar("--secondary"), 0.6), 1.1],
        ["intermediate", "Intermediate", cssVar("--accent"), 2.2],
        ["strategic", "Strategic", rgba(cssVar("--blue"), 0.7), 1.1],
      ].map(([k, label, color, w]) => ({ label, data: hist[k], borderColor: color, backgroundColor: color, borderWidth: w, spanGaps: true })) },
      { money: false, yMin: -100, yMax: 100, zero: false, maxXTicks: 8, tooltip: (c) => `${c.dataset.label}: ${signed(c.parsed.y)}`,
        lines: { y: [{ value: 20, color: rgba(cssVar("--green"), 0.5) }, { value: -20, color: rgba(cssVar("--red"), 0.5) }] } })),
    rcard("Flags", null, (m.flags || []).length ? m.flags.map((f) => h("div", { class: "flag" },
      h("span", { class: "kind " + f.kind, text: f.kind }),
      h("div", {}, h("div", { class: "callout", style: "font-weight:600", text: `${f.title} · ${f.sessions} sessions` }), h("div", { class: "callout secondary", text: f.text }))))
      : h("div", { class: "secondary", text: "No divergence or risk flags are active." })),
    rcard("Explore a what-if", "RoRo scores describe current conditions. They are not converted into return predictions. The stress test shows the effect of a market move you choose; it says nothing about how likely that move is.",
      h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" },
        h("a", { class: "btn", href: "#/advisor/portfolio_stress", text: "Open the Portfolio stress test" }),
        h("a", { class: "btn", href: "#/client/risk", text: "Open the risk tool in Client Mode" }))),
  ];
}

function seriesLabel(source, status) {
  if (status === "ok") return source === "FRED" ? "latest published" : "latest close (delayed)";
  if (status === "missing") return "unavailable";
  if (String(status).startsWith("cache") || String(status).includes("using cache")) return "cached (download failed)";
  return status;
}

function roroFactors(m) {
  const names = m.bucket_names || {};
  const health = Object.fromEntries((m.health || []).map((x) => [`${x.source}|${x.id}`, x]));
  const meta = Object.fromEntries((data.meta?.factors || []).map((f) => [f.id, f]));
  const keys = data.meta?.buckets?.map((b) => b.id) || Object.keys(names);
  const rows = (m.factors || []).filter((f) => S.roroBucket === "ALL" || f.bucket === S.roroBucket);
  const v = m.vix, lead = m.leadership;
  return [
    h("div", { class: "seg wide" }, [["ALL", `All ${(m.factors || []).length}`], ...keys.map((k) => [k, names[k] || k])].map(([k, l]) =>
      h("button", { class: S.roroBucket === k ? "on" : null, text: l, onclick: () => { S.roroBucket = k; route(); } }))),
    rcard("Factor detail", "Reading → score uses a fixed piecewise-linear map for each factor (hover a score to see its map). Weight is the factor's share of its bucket today; missing factors are re-weighted away.",
      h("div", { class: "tablewrap", style: "max-height:none" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, ["Factor", "Reading", "Score", "", "Weight", "Signal", "Data source · latest observation · status"].map((t, i) =>
          h("th", { class: [0, 3, 5, 6].includes(i) ? "l" : null, text: t })))),
        h("tbody", {}, rows.map((f) => {
          const mm = meta[f.id];
          const mapText = mm ? "Score map (reading → score): " + mm.map.map(([x, s]) => `${Format.plain(x * (mm.scale || 1), 2)} → ${s}`).join(", ") : "";
          const ser = mm?.series || [];
          return h("tr", {},
            h("td", { class: "l" }, h("div", { text: f.name }), h("div", { class: "caption secondary", text: names[f.bucket] || f.bucket })),
            h("td", { text: f.reading ?? "—" }),
            h("td", { class: "c-" + tone(f.score), style: "font-weight:600", title: mapText, text: signed(f.score) }),
            h("td", { class: "l", style: "width:110px;min-width:110px" }, scoreBar(f.score)),
            h("td", { class: "secondary", text: f.weight !== null && f.weight !== undefined ? `${Math.round(f.weight)}%` : "—" }),
            h("td", { class: "l signal c-" + tone(f.score), text: f.signal || "" }),
            h("td", { class: "l" }, ser.slice(0, 3).map((s) => {
              const st = health[`${s.source}|${s.id}`];
              return h("div", { class: "caption " + (st?.status === "ok" ? "secondary" : "warn"), text: `${s.source} ${s.id} · ${st?.last ?? "no data"} · ${seriesLabel(s.source, st?.status ?? "missing")}` });
            }), ser.length > 3 ? h("div", { class: "caption secondary", text: `+ ${ser.length - 3} more (see Data status)` }) : null));
        }))))),
    v ? rcard("VIX context", `Historical averages of S&P 500 returns over the following 12 months, grouped by how far the VIX was above its long-run average (since ${v.since}). Past averages, not a forecast.`,
      h("div", { class: "callout", style: "font-weight:600", text: `VIX ${Format.plain(v.current, 1)} · long-run mean ${Format.plain(v.mean, 1)} · ${v.zone}` }),
      h("table", { class: "grid" }, h("thead", {}, h("tr", {}, ["VIX range", "Avg. next-12-month return", "Share positive", "Days observed"].map((t, i) => h("th", { class: i === 0 ? "l" : null, text: t })))),
        h("tbody", {},
          h("tr", {}, h("td", { class: "l", text: "Below mean + 1σ" }), h("td", { text: pctS(v.base?.ret) }), h("td", { text: v.base?.win !== undefined ? `${Math.round(v.base.win)}%` : "—" }), h("td")),
          (v.levels || []).map((l) => h("tr", {}, h("td", { class: "l", text: `${Format.plain(l.lo, 1)}` + (l.hi !== null && l.hi !== undefined ? ` – ${Format.plain(l.hi, 1)}` : " and above") }),
            h("td", { text: pctS(l.ret) }), h("td", { text: l.win !== null && l.win !== undefined ? `${Math.round(l.win)}%` : "—" }), h("td", { text: l.n ?? "" })))))) : null,
    lead ? rcard("Asset-class leadership", "Ranked by a blend of 13-week (60%) and 4-week (40%) price change of representative ETFs.",
      h("table", { class: "grid" }, h("thead", {}, h("tr", {}, ["#", "Asset class", "ETFs", "13 weeks", "4 weeks", "Trend"].map((t, i) => h("th", { class: [0, 1, 2, 5].includes(i) ? "l" : null, text: t })))),
        h("tbody", {}, (lead.rows || []).map((r) => h("tr", {}, h("td", { class: "l", text: r.rank }), h("td", { class: "l", text: r.name }), h("td", { class: "l secondary", text: r.tickers }),
          h("td", { text: pctS(r.r13) }), h("td", { text: pctS(r.r4) }), h("td", { class: "l secondary", text: r.trend })))))) : null,
  ];
}

function roroScenarios(m) {
  return [
    rcard("Scenario re-scores", "Each card re-scores the model after replacing some factor readings with the stated shock values. It shows how the dials would read if those readings occurred. It is a mechanical re-score with no probability attached, and it is not a forecast of portfolio returns.",
      h("div", { class: "scgrid" }, (m.scenarios || []).map((s) => h("div", { class: "scen" },
        h("div", { style: "display:flex;justify-content:space-between;gap:8px" }, h("strong", { text: s.name }), h("span", { class: "signal " + (s.dir === "RISK-ON" ? "c-pos" : "c-neg"), text: s.dir })),
        h("div", { class: "caption secondary", text: s.desc }),
        (s.horizons || []).map((z) => h("div", { class: "callout tnum", style: "display:flex;gap:8px;align-items:baseline" },
          h("span", { style: "width:100px", text: z.label }), h("span", { text: `${signed(z.today)} → ${signed(z.after)}` }), h("span", { class: "secondary", text: `(${signed(z.delta)})` }),
          h("span", { style: "flex:1" }), h("span", { class: "signal c-" + bandTone(z.posture), text: z.posture }))),
        h("div", { class: "caption secondary", text: "Largest score moves: " + (s.moves || []).map((x) => `${x.name} ${signed(x.delta)}`).join(" · ") }))))),
    rcard("Historical look-alikes", "Past month-ends whose six bucket scores most resembled today's, and what the S&P 500 did afterwards. “Signal” replays the Offense/Defense rule with today's score maps on revised data, so these are in-sample illustrations, not out-of-sample evidence and not a prediction.",
      (m.analogs || []).length ? h("div", { class: "tablewrap", style: "max-height:none" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, ["Period", "Match", "S&P +3m", "+6m", "+12m", "Max drawdown", "Rule vs. hold", "Outcome"].map((t, i) => h("th", { class: i === 0 || i === 7 ? "l" : null, text: t })))),
        h("tbody", {}, m.analogs.map((a) => h("tr", {}, h("td", { class: "l", text: a.date }), h("td", { text: `${Math.round(a.sim)}%` }),
          h("td", { text: pctS(a.fwd3) }), h("td", { text: pctS(a.fwd6) }), h("td", { text: pctS(a.fwd12) }), h("td", { text: pctS(a.maxdd) }), h("td", { text: pctS(a.net) }),
          h("td", { class: "l caption secondary", text: (a.verdict || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) }))))))
        : h("div", { class: "secondary", text: "Not enough history to find look-alikes." })),
  ];
}

function roroDataStatus(m) {
  const health = m.health || [];
  const weights = data.meta?.weights, buckets = data.meta?.buckets || [], horizons = data.meta?.horizons || [];
  return [
    rcard("Where the data comes from", null,
      h("div", { class: "callout", text: `• FRED (Federal Reserve Bank of St. Louis), public CSV feed: ${data.meta?.fredCount ?? 18} economic, rate and credit series. Official published data; most series lag by a day to a month.` }),
      h("div", { class: "callout", text: `• Yahoo Finance chart feed: daily closing prices for ${data.meta?.yahooCount ?? 42} indexes, ETFs, futures and currencies. This is an unofficial, unlicensed feed: prices are delayed, can lag by a day, and the feed may change or stop without notice.` }),
      h("div", { class: "callout", text: "• Nothing here is real-time. On the web, the Mac app's own RoRo engine downloads and scores the data once each weekday after the close, and the result is published with this site. Your browser only loads that published file." }),
      h("div", { class: "callout secondary", text: `Scores were computed at ${m.generated} UTC from data as of ${m.asof}.` })),
    rcard(`Every series · ${health.filter((x) => x.status === "ok").length} of ${health.length} downloaded this run`, null,
      h("div", { class: "health" }, health.map((x) => h("div", {},
        h("span", { class: "dot", style: `background:${x.status === "ok" ? "var(--green)" : x.status === "missing" ? "var(--red)" : "var(--orange)"}` }),
        h("span", { class: "mono", style: "flex:1", text: `${x.source} ${x.id}` }), h("span", { class: "tnum", text: x.last ?? "—" }),
        h("span", { class: "secondary", text: seriesLabel(x.source, x.status) }))))),
    rcard("Method", null,
      h("div", { class: "callout", text: "Each factor's raw reading is mapped to a score from −100 (risk-off) to +100 (risk-on) with a fixed piecewise-linear map, weighted within its bucket, and the six buckets are combined with horizon-specific weights. Tactical uses the raw daily composite; Intermediate and Strategic are smoothed with 5- and 20-day exponential averages. Missing factors are re-weighted away rather than treated as zero. The VIX is scored as a contrarian indicator." }),
      h("div", { class: "callout", text: "The score maps are hand-set, not statistically fitted, and the model has not been validated as a predictor of returns. Treat it as a structured summary of conditions, not a forecast." }),
      weights ? h("table", { class: "grid", style: "width:auto" },
        h("thead", {}, h("tr", {}, h("th", { class: "l", text: "Bucket weights" }), buckets.map((b) => h("th", { text: b.name })))),
        h("tbody", {}, horizons.map((z) => h("tr", {}, h("td", { class: "l", text: z.label }), buckets.map((b) => h("td", { text: weights[z.id]?.[b.id] ?? 0 })))))) : null),
  ];
}

function roroPage() {
  const m = data.roro;
  const st = roroStatus(m);
  const tabs = ["Overview", "Factors", "Scenarios & history", "Data status", "Full report"];
  let content;
  if (m === undefined) content = h("div", { class: "unavailable" }, h("p", { text: "Loading the latest published RoRo data…" }));
  else if (m === null) content = unavailable("gauge", "RoRo Composite", "The RoRo data hasn't been published yet, or couldn't be loaded. It is rebuilt every weekday after the market close.");
  else if (S.roroTab === 4) content = h("iframe", { class: "report-frame", src: "roro_report.html", title: "RoRo full report" });
  else content = h("div", { class: "page xwide", style: "gap:16px" },
    printHead("RoRo Composite", `Data as of ${m.asof}`),
    [roroOverview, roroFactors, roroScenarios, roroDataStatus][S.roroTab](m));
  return {
    title: "RoRo Composite", subtitle: m?.asof ? `Data as of ${m.asof}` : "Risk-on / risk-off conditions",
    actions: () => [
      tbtn("refresh", "Refresh", async () => { await loadRoRo(true); route(); toast("Reloaded the latest published RoRo data."); }, { help: "Reload the latest published RoRo data" }),
      tbtn("share", "Save report", () => { location.href = "roro_report.html"; }, { disabled: !m, help: "Open the full report as its own page (save it from your browser)" }),
    ],
    body: [
      h("div", { class: "statusbar" },
        h("span", { class: "statuspill " + st.cls, style: "background:color-mix(in srgb, currentColor 16%, transparent)", text: st.label.toUpperCase() }),
        h("span", { class: "secondary", text: st.detail }), h("span", { style: "flex:1" }),
        h("span", { class: "caption tertiary", text: "Model output for discussion. Not investment advice." })),
      h("div", { class: "roro-tabs" }, h("div", { class: "seg wide", role: "tablist" }, tabs.map((t, i) =>
        h("button", { role: "tab", "aria-selected": String(S.roroTab === i), class: S.roroTab === i ? "on" : null, text: t, onclick: () => { S.roroTab = i; route(); } })))),
      content,
    ],
  };
}

// ---------------------------------------------------------------------------
// Client Mode

const F = (id, label, lo, hi, step, blankValue) => ({ id, label, range: [lo, hi], step, blank: blankValue });
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
  { id: "growth", title: "How does my money grow?", blurb: "See what regular saving and compound growth can add up to.", icon: "growth" },
  { id: "retirement", title: "Am I on track for retirement?", blurb: "Project savings to and through retirement, and how long they could last.", icon: "walk" },
  { id: "risk", title: "How much investment risk am I taking?", blurb: "See what a market drop or a rate change would do to a portfolio mix.", icon: "shield" },
  { id: "decisions", title: "How do my decisions change my future?", blurb: "Compare two choices side by side: retire earlier, save more, spend less.", icon: "branch" },
  { id: "taxes", title: "How do taxes and inflation affect my money?", blurb: "See what inflation does to buying power and what taxes take from growth.", icon: "percent" },
  { id: "market", title: "What are market conditions right now?", blurb: "A plain summary of today's economic and market backdrop from public data.", icon: "gauge" },
];

const raw = (key, id) => S.client[key]?.[id] ?? "";
const setRaw = (key, id, v) => { (S.client[key] ||= {})[id] = v; };

function clientRun(key, calcID, fields, overrides = {}) {
  const calc = engine.calculator(calcID);
  if (!calc) return null;
  const inputs = blankInputs(calc);
  for (const f of calc.fields) {
    const typed = String(overrides[f.id] ?? raw(key, f.id)).trim();
    const spec = fields.find((x) => x.id === f.id);
    if (typed) inputs[f.id] = typed; else if (spec?.blank !== undefined) inputs[f.id] = spec.blank;
  }
  const labels = Object.fromEntries(fields.map((x) => [x.id, x.label]));
  const ev = engine.evaluate(calc, inputs);
  return {
    calc, inputs, ev, labels, ok: Engine.isComplete(ev),
    v: (i) => ev.outputs[i]?.value ?? NaN,
    missing: calc.fields.filter((f) => ev.fieldErrors[f.id] && blank(inputs[f.id])).map((f) => labels[f.id] ?? f.label),
    problems: [...calc.fields.filter((f) => ev.fieldErrors[f.id] && !blank(inputs[f.id])).map((f) => `${labels[f.id] ?? f.label}: ${ev.fieldErrors[f.id]}`), ...ev.ruleErrors],
  };
}

function inputRow(key, calcID, field, onChange) {
  const unit = engine.calculator(calcID)?.fields.find((f) => f.id === field.id)?.unit ?? "x";
  const [lo, hi] = field.range;
  const sliderValue = () => {
    let v;
    try { v = Engine.parseNumber(raw(key, field.id) || field.blank || "", false); } catch { v = lo; }
    return Math.min(Math.max(v, lo), hi);
  };
  const id = `in-${key}-${field.id}`.replace(/\W/g, "_");
  const text = h("input", { type: "text", id, inputmode: "decimal", autocomplete: "off", class: unit === "$" ? "money" : null,
    placeholder: field.blank ?? "", value: raw(key, field.id),
    oninput: () => { setRaw(key, field.id, text.value); slider.value = sliderValue(); onChange(); } });
  const slider = h("input", { type: "range", min: lo, max: hi, step: field.step, value: sliderValue(), "aria-label": field.label,
    oninput: () => {
      const s = Format.plain(Math.round(Number(slider.value) / field.step) * field.step, field.step < 1 ? 2 : 0);
      text.value = s; setRaw(key, field.id, s); onChange();
    } });
  return h("div", { class: "crow" },
    h("div", { class: "top" }, h("label", { for: id, text: field.label }),
      h("span", { class: "box" }, unit === "$" ? "$" : null, text, unit === "%" ? "%" : null)),
    slider);
}
const inputs = (key, calcID, fields, on) => fields.map((f) => inputRow(key, calcID, f, on));
const group = (title, note, ...kids) => h("div", { class: "igroup" }, h("p", { class: "cap-title", text: title }), note ? h("p", { class: "note", text: note }) : null, ...kids);
const headline = (text, cap) => h("div", { class: "headline" }, h("div", { class: "big", text }), cap ? h("div", { class: "cap", text: cap }) : null);
const stat = (label, value, cap, neg) => h("div", { class: "stat" }, h("div", { class: "lbl", text: label }),
  h("div", { class: "val" + (neg ? " neg" : ""), text: value, title: value }), cap ? h("div", { class: "cp", text: cap }) : null);
const stats = (...k) => h("div", { class: "stats" }, ...k);
const chartCard = (title, note, ...kids) => h("section", { class: "card" }, h("h3", { style: "margin:0;font-size:15px", text: title }), ...kids, note ? h("p", { class: "note", text: note }) : null);
const footnote = () => h("p", { class: "footnote", text: "These are educational illustrations based only on the numbers typed in. They are not advice, a recommendation or a prediction. Nothing typed here is saved or sent; it is erased when this tab closes." });
function needsInput(c) {
  if (!c) return h("div", { class: "needs secondary", text: "This tool is unavailable." });
  return h("div", { class: "needs" }, c.problems.map((p) => h("div", { class: "prob" }, icon("warn"), p)),
    c.missing.length ? [h("h3", { text: "To see the picture, fill in:" }), c.missing.map((x) => h("div", { class: "miss", text: x }))] : null);
}
function howItWorks(calcs) {
  return h("details", { class: "how disc" }, h("summary", { text: "How this is calculated, and what it assumes" }),
    calcs.map((c) => h("div", { class: "how-item" }, h("h4", { text: c.calc.name }), h("code", { text: c.calc.math }),
      h("p", { text: c.calc.assumptions }), h("p", { text: c.calc.interpretation }),
      h("button", { class: "link no-print", style: "align-self:flex-start;font-size:12px", text: "Open the full calculator in Advisor Mode",
        onclick: () => { S.working[c.calc.id] = { ...c.inputs }; location.hash = `#/advisor/${c.calc.id}`; } }))));
}

let clientCalcs = () => [];   // the calculators behind the open tool, for the PDF report check

function clientHome() {
  return {
    title: "Wealth Desk", subtitle: "Client Mode",
    leading: () => tbtn("grid", "All tools", null, { disabled: true }),
    actions: () => [tbtn("doc", "PDF report", null, { disabled: true }), tbtn("eraser", "Clear", clearSession, { help: "Erase everything typed this session" })],
    body: h("div", { class: "home" },
      h("div", {}, h("h1", { text: "What would you like to explore?" }), h("p", { class: "lede", text: "Pick a question, type in any numbers, and watch the picture change." })),
      h("div", { class: "qcards" }, TOOLS.map((t) => h("a", { class: "qcard", href: `#/client/${t.id}` }, icon(t.icon), h("h2", { text: t.title }), h("p", { text: t.blurb })))),
      footnote()),
  };
}

function toolPage(tool, inputPanel, renderResults, calcsForReport) {
  const results = h("div", { class: "tool-out-inner" });
  const refresh = () => schedule(() => {
    destroyCharts();
    fill(results, printHead("Client illustration", tool.title), h("h1", { class: "serif", text: tool.title }), renderResults(), footnote());
    mountCharts(results);
  });
  const panel = h("aside", { class: "tool-in" });
  const refill = () => fill(panel, inputPanel(refresh, refill));
  refill();
  clientCalcs = calcsForReport;
  return {
    title: tool.title, subtitle: "Client Mode",
    leading: () => h("a", { class: "tbtn", href: "#/client", title: "Back to all six questions" }, icon("grid"), h("span", { text: "All tools" })),
    actions: () => [
      tbtn("doc", "PDF report", () => { clientCalcs().some((c) => c?.ok) ? window.print() : toast("Nothing to report yet. Fill in the numbers first."); },
        { help: "Print, or choose Save as PDF in the print dialog" }),
      tbtn("eraser", "Clear", clearSession, { help: "Erase everything typed this session" }),
    ],
    body: h("div", { class: "tool" }, panel, h("section", { class: "tool-out" }, results)),
    mounted: refresh,
  };
}

function growthTool(tool) {
  const run = () => clientRun("client.growth", "growth_schedule", Spec.growth);
  return toolPage(tool, (on) => [
    group("Your numbers", null, inputs("client.growth", "growth_schedule", Spec.growth.slice(0, 2), on)),
    group("Assumptions", "These are yours to set. A return is an assumption, not a promise.", inputs("client.growth", "growth_schedule", Spec.growth.slice(2), on)),
  ], () => {
    const c = run();
    if (!c?.ok || !c.ev.table) return needsInput(c);
    const rows = c.ev.table.rows, years = rows.length ? rows[rows.length - 1][0] : 0, A = cssVar("--accent"), G = "#8e8e93";
    return [
      headline(`After ${years} years this could grow to ${Format.currency(c.v(0))}.`, `${Format.currency(c.v(1))} is money put in; ${Format.currency(c.v(2))} is growth on top of it.`),
      stats(stat("Ending balance", Format.currency(c.v(0))), stat("Money put in", Format.currency(c.v(1))),
        stat("Growth earned", Format.currency(c.v(2)), null, c.v(2) < 0), stat("What it buys in today's dollars", Format.currency(c.v(3)), "After the inflation entered")),
      chartCard("Year by year", "Growth compounds: each year's gains earn gains of their own.",
        chart("line", { datasets: [
          { label: "Money put in", data: rows.map((r) => ({ x: r[0], y: r[1] })), fill: "origin", stack: "a", backgroundColor: rgba(G, 0.45), borderColor: rgba(G, 0.8), borderWidth: 1 },
          { label: "Growth", data: rows.map((r) => ({ x: r[0], y: Math.max(r[2], 0) })), fill: "-1", stack: "a", backgroundColor: rgba(A, 0.6), borderColor: A, borderWidth: 1 },
          { label: "Balance in today's dollars", data: rows.map((r) => ({ x: r[0], y: r[4] })), stack: "b", borderColor: cssVar("--secondary"), borderDash: [4, 3], borderWidth: 1.5 },
        ] }, { xType: "linear", stacked: true, xTitle: "Years from now", size: "h260" }),
        h("div", { class: "caption secondary", text: "Dashed line: the balance in today's dollars." })),
      howItWorks([c]),
    ];
  }, () => [run()]);
}

function retirementTool(tool) {
  const t = () => clientRun("client.retirement", "retirement_timeline", Spec.retirement);
  return toolPage(tool, (on) => [
    group("About you", null, inputs("client.retirement", "retirement_mc", Spec.retirementYou, on)),
    group("Assumptions", "Leave volatility empty for a single steady path, or enter it to see a range of outcomes.", inputs("client.retirement", "retirement_mc", Spec.retirementAssumptions, on)),
  ], () => {
    const c = t();
    const hasVol = !blank(raw("client.retirement", "sd"));
    const mc = hasVol ? clientRun("client.retirement", "retirement_mc", Spec.retirement) : null;
    if (!c?.ok || !c.ev.table) return needsInput(c);
    const rows = c.ev.table.rows, plan = (rows.length ? rows[rows.length - 1][0] : 0) + 1, lasts = c.v(3) < 0;
    const rate = c.v(0) > 0 ? c.v(1) / c.v(0) : NaN, band = mc?.ok ? mc.ev.table.rows : [], A = cssVar("--accent");
    const ds = [];
    if (band.length) {
      ds.push({ label: "90th percentile", data: band.map((r) => ({ x: r[0], y: r[3] })), borderWidth: 0, fill: "+1", backgroundColor: rgba(A, 0.18) });
      ds.push({ label: "10th percentile", data: band.map((r) => ({ x: r[0], y: r[1] })), borderWidth: 0 });
    }
    ds.push({ label: "Steady path", data: rows.map((r) => ({ x: r[0] + 1, y: r[5] })), borderColor: A, borderWidth: 2.5 });
    const retire = Number(c.inputs.retire);
    return [
      headline(lasts ? `On this steady path the money lasts through age ${plan}.` : `On this steady path the money runs out around age ${Math.trunc(c.v(3))}.`,
        lasts ? `About ${Format.currency(c.v(2))} would remain at the end of the plan.` : `That is ${Math.trunc(plan - c.v(3))} years before the end of the plan.`),
      stats(stat("Savings at retirement", Format.currency(c.v(0))),
        stat("First-year withdrawal", Format.currency(c.v(1)), Number.isNaN(rate) ? null : `${Format.percent(rate)} of savings at retirement`),
        stat(lasts ? "Left at end of plan" : "Money runs out at age", lasts ? Format.currency(c.v(2)) : String(Math.trunc(c.v(3))), null, !lasts),
        mc?.ok ? stat("Simulated paths where the money lasts", Format.percent(mc.v(0)), `Out of ${mc.inputs.sims} random market paths`) : null),
      chartCard("Savings over time", mc?.ok ? "Shaded band: the middle 80% of simulated outcomes. Solid line: the steady path. Markets don't deliver the same return every year, so the band is the more realistic picture."
        : "A single steady path with the same return every year. Enter a volatility assumption to see a range.",
      chart("line", { datasets: ds }, { xType: "linear", xTitle: "Age", legend: false, size: "h280", lines: Number.isFinite(retire) ? { x: [{ value: retire, label: "Retire" }] } : {} })),
      mc && !mc.ok ? needsInput(mc) : null,
      howItWorks([c, ...(mc?.ok ? [mc] : [])]),
    ];
  }, () => [t()]);
}

function riskTool(tool) {
  const a = () => clientRun("client.risk", "portfolio_stress", Spec.risk);
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
  return toolPage(tool, (on, refill) => [
    group("Portfolio", "Whatever isn't in stocks or bonds is treated as cash.", inputs("client.risk", "portfolio_stress", Spec.risk.slice(0, 3), on)),
    group("What if…", "You choose the scenario. This shows what would happen if it occurred, not how likely it is.", inputs("client.risk", "portfolio_stress", Spec.risk.slice(3), on)),
    group("Compare another mix", null,
      h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: S.compare, onchange: (e) => { S.compare = e.target.checked; refill(); on(); } }), "Show a second mix side by side"),
      S.compare ? inputs("client.risk.B", "portfolio_stress", [F("we", "Stocks (mix B)", 0, 100, 5), F("wb", "Bonds (mix B)", 0, 100, 5)], on) : null),
    group("Typical ups and downs (optional)", "Enter volatility assumptions to see how much the mix usually moves in a year.", inputs("client.risk.vol", "mix_volatility", Spec.volatility, on)),
  ], () => {
    const A = a(), B = S.compare ? mixB() : null, V = vol();
    if (!A?.ok) return needsInput(A);
    const down = A.v(2) < 0, ba = bars(A, "Mix A"), bb = B?.ok ? bars(B, "Mix B") : null;
    const series = (k) => [...(ba?.[k] ?? []), ...(bb?.[k] ?? [])];
    return [
      headline(`In this scenario the portfolio would be about ${Format.currency(Math.abs(A.v(2)))} ${down ? "lower" : "higher"} (${Format.percent(A.v(3))}).`,
        "A what-if based on the changes entered. It is not a forecast and says nothing about how likely this is."),
      stats(stat("Change in value", Format.currency(A.v(2)), null, down), stat("Change in percent", Format.percent(A.v(3)), null, down),
        stat("Value afterwards", Format.currency(A.v(4)), "After any withdrawal entered"), stat("From stocks / from bonds", `${Format.compact(A.v(0))} / ${Format.compact(A.v(1))}`)),
      B?.ok ? chartCard("Mix A compared with mix B", "Same scenario, two different mixes.",
        stats(stat("Mix A change", Format.currency(A.v(2)), Format.percent(A.v(3)), A.v(2) < 0), stat("Mix B change", Format.currency(B.v(2)), Format.percent(B.v(3)), B.v(2) < 0),
          stat("Difference (B − A)", Format.currency(B.v(2) - A.v(2))))) : (S.compare && B ? needsInput(B) : null),
      chartCard("Before and after", "Bond values are estimated from duration: a 1% rise in rates lowers bond prices by roughly the duration in percent.",
        chart("bar", { labels: [...(ba?.labels ?? []), ...(bb?.labels ?? [])], datasets: [
          { label: "Stocks", data: series("stocks"), backgroundColor: cssVar("--accent") },
          { label: "Bonds", data: series("bonds"), backgroundColor: rgba(cssVar("--blue"), 0.7) },
          { label: "Cash", data: series("cash"), backgroundColor: rgba("#8e8e93", 0.5) },
        ] }, { stacked: true, size: "h260" })),
      V?.ok ? chartCard("Typical ups and downs", "Volatility is a yardstick for normal fluctuation, not a worst case and not a prediction.",
        stats(stat("Volatility of this mix", Format.percent(V.v(0)), "Standard deviation of yearly returns, from your assumptions"),
          stat("A typical one-year swing", "± " + Format.currency(V.v(1))), stat("Share of the risk from stocks", Format.percent(V.v(2))))) : null,
      h("div", {}, h("a", { href: "#/client/market", class: "callout", text: "See current market conditions" })),
      howItWorks([A, ...(V?.ok ? [V] : [])]),
    ];
  }, () => [a()]);
}

function decisionsTool(tool) {
  const a = () => clientRun("client.retirement", "retirement_timeline", Spec.retirement);
  const optionB = () => {
    const over = {};
    for (const f of Spec.decisionLevers) if (!blank(raw("client.decisions.B", f.id))) over[f.id] = raw("client.decisions.B", f.id);
    return clientRun("client.retirement", "retirement_timeline", Spec.retirement, over);
  };
  const lasts = (c) => (c.v(3) < 0 ? "Lasts through the plan" : `Runs out at age ${Math.trunc(c.v(3))}`);
  const row = (label, x, y) => {
    const d = y - x;
    return h("tr", {}, h("td", { text: label }), h("td", { text: Format.currency(x) }), h("td", { text: Format.currency(y) }),
      h("td", { class: d < 0 ? "down" : "pos", style: d < 0 ? "" : "color:var(--accent)", text: (d >= 0 ? "+" : "") + Format.currency(d) }));
  };
  return toolPage(tool, (on) => [
    group("Option A: the starting plan", "Shared with “Am I on track for retirement?”.",
      inputs("client.retirement", "retirement_mc", Spec.retirementYou, on), inputs("client.retirement", "retirement_mc", Spec.retirementAssumptions.slice(0, 3), on)),
    group("Option B: change one or more things", "Leave a box empty to keep it the same as option A.", inputs("client.decisions.B", "retirement_mc", Spec.decisionLevers, on)),
  ], () => {
    const A = a(), B = optionB(), changed = Spec.decisionLevers.some((f) => !blank(raw("client.decisions.B", f.id)));
    if (!(A?.ok && B?.ok && A.ev.table && B.ev.table)) return needsInput(A?.ok ? B : A);
    const diff = B.v(2) - A.v(2);
    return [
      changed ? headline(`Option B ends the plan with ${Format.currency(Math.abs(diff))} ${diff >= 0 ? "more" : "less"} than option A.`, `A: ${lasts(A)}. B: ${lasts(B)}.`)
        : headline("Change something under Option B to compare.", "For example: retire five years earlier, save more each year, or spend less in retirement."),
      h("section", { class: "card" }, h("table", { class: "cmp" },
        h("thead", {}, h("tr", {}, h("th"), h("th", { text: "Option A" }), h("th", { text: "Option B" }), h("th", { text: "Difference" }))),
        h("tbody", {}, row("Savings at retirement", A.v(0), B.v(0)), row("First-year withdrawal", A.v(1), B.v(1)), row("Left at end of plan", A.v(2), B.v(2)),
          h("tr", {}, h("td", { text: "How long the money lasts" }), h("td", { text: lasts(A) }), h("td", { text: lasts(B) }), h("td"))))),
      chartCard("Savings over time", "Both lines use a steady return every year. Real markets vary; see the retirement tool for a range of outcomes.",
        chart("line", { datasets: [
          { label: "Option A", data: A.ev.table.rows.map((r) => ({ x: r[0] + 1, y: r[5] })), borderColor: "#8e8e93", backgroundColor: "#8e8e93", borderWidth: 2.5 },
          { label: "Option B", data: B.ev.table.rows.map((r) => ({ x: r[0] + 1, y: r[5] })), borderColor: cssVar("--accent"), backgroundColor: cssVar("--accent"), borderWidth: 2.5 },
        ] }, { xType: "linear", xTitle: "Age", size: "h280" })),
      howItWorks([A]),
    ];
  }, () => [a(), optionB()]);
}

function taxesTool(tool) {
  const infl = () => clientRun("client.inflation", "inflation_cost", Spec.inflation);
  const drag = () => clientRun("client.taxdrag", "tax_deferral", Spec.taxDrag);
  const tax = () => clientRun("client.incometax", "income_tax", Spec.incomeTax);
  return toolPage(tool, (on, refill) => {
    const seg = h("div", { class: "seg wide" }, ["Inflation", "Taxes on growth", "Income tax"].map((t, i) =>
      h("button", { class: S.taxTab === i ? "on" : null, text: t, onclick: () => { S.taxTab = i; refill(); on(); } })));
    if (S.taxTab === 0) return [seg, group("Inflation and buying power", null, inputs("client.inflation", "inflation_cost", Spec.inflation, on))];
    if (S.taxTab === 1) return [seg, group("Taxes on investment growth", "Compares paying tax on earnings every year with paying once at the end.", inputs("client.taxdrag", "tax_deferral", Spec.taxDrag, on))];
    const f = engine.calculator("income_tax").fields.find((x) => x.id === "status");
    const cur = raw("client.incometax", "status") || f.example;
    return [seg, group("Federal income tax estimate", "Federal tax on ordinary taxable income only. No state tax, credits or other taxes.",
      inputs("client.incometax", "income_tax", Spec.incomeTax, on),
      h("div", { class: "crow" }, h("div", { class: "top" }, h("label", { for: "status", text: "Filing status" }),
        h("select", { id: "status", onchange: (e) => { setRaw("client.incometax", "status", e.target.value); on(); } },
          f.options.map((o) => h("option", { value: Format.plain(o.value), selected: Format.plain(o.value) === cur, text: o.label }))))))];
  }, () => {
    if (S.taxTab === 0) {
      const c = infl();
      if (!c?.ok) return needsInput(c);
      const n = Math.trunc(Number(c.inputs.n)), pts = [];
      for (let k = 0; k <= n; k++) {
        const v = engine.evaluate(c.calc, { ...c.inputs, n: String(k) }).outputs[1]?.value;
        if (v !== null && v !== undefined) pts.push({ x: k, y: v });
      }
      let amount = c.inputs.c;
      try { amount = Format.currency(Engine.parse(c.inputs.c, c.calc.fields[0])); } catch { /* keep text */ }
      const A = cssVar("--accent");
      return [
        headline(`What costs ${amount} today would cost about ${Format.currency(c.v(0))} in ${n} years.`, `Put another way, that same amount of money would then buy only what ${Format.currency(c.v(1))} buys today.`),
        stats(stat("Future cost of the same thing", Format.currency(c.v(0))), stat("Buying power of today's amount, later", Format.currency(c.v(1)), null, true)),
        chartCard("Buying power over time", "Each point is the same calculation for that many years.",
          chart("line", { datasets: [{ label: "Buying power", data: pts, borderColor: A, backgroundColor: rgba(A, 0.2), fill: "origin", borderWidth: 2 }] }, { xType: "linear", xTitle: "Years from now", legend: false })),
        howItWorks([c]),
      ];
    }
    if (S.taxTab === 1) {
      const c = drag();
      if (!c?.ok) return needsInput(c);
      return [
        headline(`Paying tax on earnings every year leaves ${Format.currency(c.v(0))}. Deferring the tax to the end leaves ${Format.currency(c.v(1))}.`,
          `The difference, ${Format.currency(c.v(2))}, comes from letting untaxed gains keep compounding.`),
        chartCard("Ending value after tax", null, chart("bar", { labels: ["Taxed every year", "Taxed once at the end"],
          datasets: [{ label: "Ending value", data: [c.v(0), c.v(1)], backgroundColor: [rgba("#8e8e93", 0.6), cssVar("--accent")] }] }, { legend: false })),
        howItWorks([c]),
      ];
    }
    const c = tax();
    let income = null;
    try { income = Engine.parse(c?.inputs.ti ?? "", c.calc.fields[0]); } catch { /* not ready */ }
    const banner = taxBanner(() => route());
    if (!c?.ok || income === null) return [banner, needsInput(c)];
    return [
      banner,
      headline(`Estimated federal income tax: ${Format.currency(c.v(0))}, which is ${Format.percent(c.v(2))} of this income.`,
        `The next dollar earned would be taxed at ${Format.percent(c.v(1))}. That higher rate applies only to income above the bracket line, not to all of it.`),
      stats(stat("Federal income tax", Format.currency(c.v(0))), stat("Average rate on this income", Format.percent(c.v(2))),
        stat("Rate on the next dollar", Format.percent(c.v(1))), stat("Room before the next bracket", Number.isNaN(c.v(3)) ? "Top bracket" : Format.currency(c.v(3)))),
      chartCard("Where the income goes", null, chart("bar", { labels: ["Income"], datasets: [
        { label: "Kept after federal income tax", data: [income - c.v(0)], backgroundColor: cssVar("--accent") },
        { label: "Federal income tax", data: [c.v(0)], backgroundColor: cssVar("--orange") },
      ] }, { stacked: true, indexAxis: "y", size: "h110" })),
      howItWorks([c]),
    ];
  }, () => [[infl, drag, tax][S.taxTab]()]);
}

// ---------------------------------------------------------------------------
// Client: market conditions (a plain reading of the published RoRo model)
// Mirrors ClientMarketView in the Mac app. Numbers come straight from data/roro.json
// via clientMarketSummary (web/client_market.js, tested by web/client-market-check.mjs).

function marketTool(tool) {
  const m = data.roro;
  const sum = clientMarketSummary(m);
  let content;
  if (m === undefined) {
    content = [h("div", { class: "secondary", text: "Loading the latest published market data…" })];
  } else if (!sum) {
    content = [headline("Market data isn't available right now.", "It is published every weekday after the US market close. Try again later."),
      h("div", {}, tbtn("refresh", "Try again", async () => { await loadRoRo(true); route(); }))];
  } else {
    const st = roroStatus(m);
    const A = cssVar("--accent");
    content = [
      h("div", { class: "statusbar", style: "padding:0" },
        h("span", { class: "statuspill " + st.cls, style: "background:color-mix(in srgb, currentColor 16%, transparent)", text: st.label.toUpperCase() }),
        h("span", { class: "callout secondary", style: "flex:1;min-width:200px", text: st.detail }),
        h("button", { class: "btn no-print", text: "Reload", onclick: async () => { await loadRoRo(true); route(); toast("Reloaded the latest published market data."); } })),
      headline(sum.headline, `This summarizes ${sum.indicators} public economic and market indicators on a scale from −100 (stressed) to +100 (supportive). It describes conditions today. It does not predict returns and is not advice about any portfolio.`),
      h("div", { class: "row3" }, sum.horizons.map((z) => h("section", { class: "card", style: "gap:8px" },
        h("div", { class: "callout secondary", text: z.name }),
        h("div", { style: "display:flex;align-items:baseline;justify-content:space-between;gap:8px" },
          h("span", { class: "mword c-" + marketTone(z.value), text: z.word }),
          h("span", { class: "secondary tnum", text: signed(z.value) })),
        scoreBar(z.value),
        h("div", { class: "caption secondary", text: z.desc })))),
      chartCard("What is behind it", "Each bar summarizes a group of indicators. Left of center is more stressed, right is more supportive.",
        h("div", { class: "cbuckets" }, sum.buckets.map((b) => h("div", { class: "cbrow" },
          h("span", { class: "lbl", text: b.label }), scoreBar(b.value),
          h("span", { class: "wd c-" + marketTone(b.value), text: b.word }))))),
      chartCard("The last two years", "The medium-term reading over time. Conditions change; today's reading says nothing certain about tomorrow's.",
        chart("line", { labels: sum.history.map((p) => p.x), datasets: [
          { label: "Medium-term reading", data: sum.history.map((p) => p.y), borderColor: A, backgroundColor: A, borderWidth: 2 }] },
        { money: false, yMin: -100, yMax: 100, zero: false, maxXTicks: 8, legend: false, label: "Medium-term market reading over the last two years",
          tooltip: (c) => `Reading: ${signed(c.parsed.y, 1)}`, lines: { y: [{ value: 0, color: rgba("#8e8e93", 0.6) }] } })),
      h("div", { class: "no-print", style: "display:flex;gap:14px;flex-wrap:wrap;align-items:center" },
        h("a", { class: "btn", href: "#/client/risk", text: "Explore a what-if with the risk tool" }),
        h("a", { class: "callout", href: "#/advisor/roro", text: "Full detail (Advisor Mode)" })),
      h("p", { class: "note", text: "Sources: Federal Reserve Economic Data (FRED) and delayed market prices from Yahoo Finance's unofficial feed, scored once each weekday after the US close by the same engine as the Mac app. Readings come from a hand-calibrated model that has not been validated as a predictor of returns. This is general market information, not investment advice or a recommendation." }),
    ];
  }
  clientCalcs = () => [];
  return {
    title: tool.title, subtitle: "Client Mode",
    leading: () => h("a", { class: "tbtn", href: "#/client", title: "Back to all six questions" }, icon("grid"), h("span", { text: "All tools" })),
    actions: () => [
      tbtn("doc", "PDF report", () => { sum ? window.print() : toast("Market data hasn't loaded yet."); }, { help: "Print, or choose Save as PDF in the print dialog" }),
      tbtn("eraser", "Clear", clearSession, { help: "Erase everything typed this session" }),
    ],
    body: h("div", { class: "page wide" },
      printHead("Client illustration", tool.title),
      h("h1", { class: "serif", style: "margin:0", text: tool.title }),
      ...content, footnote()),
  };
}

// ---------------------------------------------------------------------------
// Router

const ADVISOR_PAGES = { roro: roroPage, markets: marketsPage, calculator: padPage, scenarios: scenariosPage, history: historyPage };

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [mode, sub] = parts;
  if (mode === "calc") { location.replace("#/advisor/calculator"); return; }
  if (mode === "advisor") {
    if (sub === "roro" && data.roro === undefined) loadRoRo().then(route);
    if (sub === "markets" && data.markets === undefined) loadMarkets().then(route);
    if (!sub) return show(advisorHome(), { mode, selected: "home" });
    if (ADVISOR_PAGES[sub]) return show(ADVISOR_PAGES[sub](), { mode, selected: sub });
    const calc = engine.calculator(sub);
    return calc ? show(calcPage(calc), { mode, selected: calc.id })
      : show({ title: "Not found", body: unavailable("info", "Not found", "That calculator isn't in this catalog.") }, { mode });
  }
  if (mode === "client") {
    const tool = TOOLS.find((t) => t.id === sub);
    if (!tool) return show(clientHome(), { mode });
    if (tool.id === "market" && data.roro === undefined) loadRoRo().then(route);
    const make = { growth: growthTool, retirement: retirementTool, risk: riskTool, decisions: decisionsTool, taxes: taxesTool, market: marketTool }[tool.id];
    return show(make(tool), { mode });
  }
  show(startPage());
}

async function boot() {
  try {
    const [catalog, tax] = await Promise.all([loadJSON("data/catalog.json"), loadJSON("data/taxdata.json")]);
    const taxData = new TaxData(tax);
    engine = new Engine(catalog, taxData, taxData.years.includes(Prefs.taxYear) ? Prefs.taxYear : undefined);
  } catch (e) {
    fill(app, unavailable("warn", "Wealth Desk couldn't start", `The calculator data didn't load (${e.message}). Check the connection and reload.`));
    return;
  }
  window.addEventListener("hashchange", route);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", route);
  if (!window.Chart) document.querySelector('script[src*="Chart"]')?.addEventListener("load", route);
  route();
}
boot();
