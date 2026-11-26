// Wealth Desk for the web. Mirrors the macOS app screen for screen: start screen, Advisor Mode
// (sidebar, calculators, Calculator, Markets, RoRo, session scenarios and history) and Client Mode.
// The engine (engine.js) is a line-by-line port of the app's, checked against it by web/parity.mjs.
// Calculator inputs live in memory only and are gone when the tab closes. Preferences (favorites,
// tax year, calculator mode) are kept in this browser, like the app keeps them on the Mac.
import {
  Engine, TaxData, withStates, Format, Scientific, fieldKind, usesTaxTable, exampleInputs, blankInputs, categories, search,
} from "./engine.js";
import { scenarioFileText, readScenarioFile } from "./scenario.js";
import { clientMarketSummary, marketTone } from "./client_market.js";
import { analyze, sma, bollinger, rsi, fibLevels } from "./stock.js";

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
  compare: false, taxTab: 0, roroTab: 0, roroBucket: "ALL", stock: null,
});
let S = freshSession();
let engine = null;
const data = { roro: undefined, meta: null, markets: undefined, tickers: undefined };
let searchText = "";
let calcQuery = "";          // the Calculators page search, kept while moving between pages

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
  beforeDatasetsDraw(chart, _a, opts) {
    const b = opts?.band;
    if (!b) return;
    const { ctx, chartArea: A, scales } = chart, y1 = scales.y.getPixelForValue(b.to), y2 = scales.y.getPixelForValue(b.from);
    ctx.save(); ctx.fillStyle = b.color; ctx.fillRect(A.left, y1, A.right - A.left, y2 - y1); ctx.restore();
  },
  afterDatasetsDraw(chart, _a, opts) {
    const { ctx, chartArea: A, scales } = chart;
    ctx.save();
    for (const l of opts?.y || []) {
      const y = scales.y.getPixelForValue(l.value);
      if (y < A.top - 1 || y > A.bottom + 1) continue;
      ctx.strokeStyle = l.color; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(A.left, y); ctx.lineTo(A.right, y); ctx.stroke();
      if (l.label) {
        // Labels sit in the space to the right of the plot (the chart reserves it with padRight), clear of the data.
        ctx.setLineDash([]); ctx.font = "11px " + cssVar("--font");
        ctx.fillStyle = cssVar("--secondary"); ctx.fillText(l.label, A.right + 6, y + 3.5);
      }
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
  // Screen readers can't read a canvas; describe it by what it plots (the table under it has the figures).
  const series = (chartData.datasets || []).map((d) => d.label).filter(Boolean).join(", ");
  const label = o.label || `${type === "bar" ? "Bar" : "Line"} chart${o.xTitle ? ` by ${o.xTitle.toLowerCase()}` : ""}${series ? `: ${series}` : ""}`;
  const canvas = h("canvas", { role: "img", "aria-label": label });
  const box = h("div", { class: "chartbox " + (o.size || "") }, canvas);
  box._make = () => {
    if (!window.Chart || box._made) return;
    box._made = true;
    const grid = cssVar("--fill-2"), muted = cssVar("--secondary");
    const money = { color: muted, callback: (v) => Format.compact(v) };
    const yTicks = o.yTicks || (o.money === false ? { color: muted } : money);
    const horizontal = o.indexAxis === "y";
    charts.push(new window.Chart(canvas, {
      type, data: chartData, plugins: [linesPlugin],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, indexAxis: o.indexAxis,
        layout: { padding: { right: o.padRight || 0 } },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: o.legend !== false, labels: { color: muted, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: o.tooltip || ((c) => `${c.dataset.label}: ${Format.currency(horizontal ? c.parsed.x : c.parsed.y)}`),
            ...(o.tooltipTitle ? { title: (items) => o.tooltipTitle(items[0].label) } : {}) } },
          wdlines: o.lines || {},
        },
        elements: { point: { radius: 0, hitRadius: 6 } },
        scales: horizontal ? {
          x: { type: "linear", stacked: o.stacked, grid: { color: grid }, ticks: money, beginAtZero: true },
          y: { stacked: o.stacked, grid: { display: false }, ticks: { color: muted } },
        } : {
          x: {
            type: o.xType || "category", stacked: o.stacked, grid: { color: grid },
            ticks: { color: muted, precision: 0, autoSkip: true, maxTicksLimit: o.maxXTicks || 12, maxRotation: 0,
              ...(o.xFormat ? { callback(v) { return o.xFormat(this.getLabelForValue(v)); } } : {}) },
            title: o.xTitle ? { display: true, text: o.xTitle, color: muted } : undefined,
          },
          y: { stacked: o.stacked, grid: { color: grid }, ticks: yTicks, beginAtZero: o.zero !== false, min: o.yMin, max: o.yMax },
        },
      },
    }));
  };
  return box;
}
// Chart.js (about 200 KB) is fetched the first time a page actually shows a chart, not on every page.
const CHART_JS = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
let chartLib = null;
function loadChartLib() {
  return chartLib ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = CHART_JS; s.async = true; s.onload = ok;
    s.onerror = () => { chartLib = null; s.remove(); fail(); };   // let a later page try again
    document.head.append(s);
  });
}
function mountCharts(root) {
  const boxes = root.querySelectorAll(".chartbox");
  if (!boxes.length) return;
  if (window.Chart) { boxes.forEach((b) => b._make && b._make()); return; }
  // Once loaded, draw whatever charts are on screen by then (the page may have changed meanwhile).
  loadChartLib().then(() => mountCharts(document), () => {});
}

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
  // Wordmark at top left, page actions and the Advisor / Client switch at top right. Each page
  // carries its own heading, so the toolbar doesn't repeat the title.
  const m = current.mode;
  fill(t,
    m === "advisor" ? h("button", { class: "iconbtn", title: "Show or hide the sidebar", "aria-label": "Toggle sidebar", onclick: toggleSidebar }, icon("sidebar")) : null,
    h("a", { class: "wordmark", href: m === "advisor" ? "#/advisor" : m === "client" ? "#/client" : "#/" }, "Wealth Desk",
      m ? h("small", { text: m === "advisor" ? "Advisor" : "Client" }) : null),
    current.leading ? current.leading() : null,
    h("div", { class: "tb-spacer" }),
    h("div", { class: "tb-actions" }, current.actions ? current.actions() : []),
    m ? modeSwitch(m) : null);
  document.title = current.title === "Wealth Desk" ? "Wealth Desk" : `${current.title} · Wealth Desk`;
}
function toggleSidebar() {
  if (matchMedia("(max-width: 760px)").matches) { shell.split.classList.toggle("mobile-open"); return; }
  Prefs.sidebar = !Prefs.sidebar; savePrefs();
  shell.split.classList.toggle("collapsed", !Prefs.sidebar);
}

// Advisor Mode has four destinations; the rest are tools. The full calculator library lives on the
// Calculators page (and in the sidebar search), not in the sidebar itself.
const SIDE = [
  ["home", "Market Brief", "gauge", "#/advisor"], ["roro", "RoRo Composite", "gauge", "#/advisor/roro"], ["stock", "Stock research", "search", "#/advisor/stock"],
  ["calculators", "Calculators", "table", "#/advisor/calculators"], ["client", "Client Mode", "people", "#/client"],
];
// Extra words the sidebar search matches for each page.
const PAGE_WORDS = {
  home: "roro market brief risk on risk off regime overview", roro: "roro risk on off composite factors regime posture market",
  stock: "stock ticker equity company fundamentals sec filings", calculators: "calculator library formulas",
  client: "client mode present", markets: "treasury yields curve bonds rates quotes watchlist markets",
  calculator: "calculator scientific", scenarios: "scenarios saved", history: "history",
};
const SIDE_TOOLS = [
  ["markets", "Treasury yields & quotes", "chart"], ["calculator", "Calculator", "plusminus"],
  ["scenarios", "Session scenarios", "tray"], ["history", "Session history", "clock"],
];
function sidebar(selected) {
  const list = h("div", { class: "sb-list", role: "list" });
  const row = (c) => h("a", { class: "sb-row" + (selected === c.id ? " sel" : ""), href: `#/advisor/${c.id}`, title: c.summary },
    h("span", { class: "grow", text: c.name }), c.acronym ? h("span", { class: "acr", text: c.acronym }) : null);
  const isCalc = !!engine.calculator(selected);
  const paint = () => {
    const q = searchText.trim();
    if (q) {
      const hits = search(q, engine.calculators);
      // Pages match by name or keyword too (RoRo, Treasury yields, stocks…), not just calculators.
      const ql = q.toLowerCase();
      const pages = [...SIDE, ...SIDE_TOOLS.map(([id, label, ic]) => [id, label, ic, `#/advisor/${id}`])]
        .filter(([id, label]) => (label + " " + (PAGE_WORDS[id] || "")).toLowerCase().includes(ql));
      fill(list, hits.length ? h("a", { class: "sb-row big", href: "#/advisor/calculators", onclick: () => { calcQuery = q; } },
          icon("table"), h("span", { class: "grow", text: `Show ${hits.length} formula${hits.length === 1 ? "" : "s"}` })) : null,
        h("div", { class: "sb-sec", text: "Results" }),
        pages.map(([id, label, ic, href]) => h("a", { class: "sb-row", href }, icon(ic), h("span", { class: "grow", text: label }))),
        hits.map(row), !hits.length && !pages.length ? h("div", { class: "sb-row secondary", text: "No matches" }) : null);
      return;
    }
    const favs = Prefs.favorites.map((id) => engine.calculator(id)).filter(Boolean);
    fill(list,
      SIDE.map(([id, label, ic, href]) => h("a", { class: "sb-row big" + (selected === id || (id === "calculators" && isCalc) ? " sel" : ""), href },
        icon(ic), h("span", { class: "grow", text: label }))),
      h("div", { class: "sb-sec", text: "Tools" }),
      SIDE_TOOLS.map(([id, label, ic]) => h("a", { class: "sb-row" + (selected === id ? " sel" : ""), href: `#/advisor/${id}` },
        icon(ic), h("span", { class: "grow", text: label }),
        id === "scenarios" && S.scenarios.length ? h("span", { class: "badge", text: S.scenarios.length }) : null)),
      favs.length ? [h("div", { class: "sb-sec", text: "Favorites" }), favs.map(row)] : null,
      isCalc && !favs.some((c) => c.id === selected) ? [h("div", { class: "sb-sec", text: "Open" }), row(engine.calculator(selected))] : null);
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

// Each page is drawn fresh, which used to drop keyboard focus back to the top of the document.
// Remember what had focus and put it back on the same control in the new page (a sidebar row, a
// tab, a toolbar button); if that control is gone (a link to another page), focus the new page's
// heading so keyboard and screen-reader users start at the content.
function focusKey() {
  const el = document.activeElement;
  if (!el || el === document.body || !app.contains(el)) return null;
  const zone = el.closest(".tb") ? ".tb" : el.closest(".sidebar") ? ".sidebar" : "#detail";
  return { zone, tag: el.tagName, id: el.id, href: el.getAttribute("href"), text: (el.getAttribute("aria-label") || el.textContent).trim() };
}
function restoreFocus(k) {
  if (!k) return;
  const narrow = matchMedia("(max-width: 760px)").matches;   // the sidebar is closed off-screen there
  const zone = k.zone === ".sidebar" && narrow ? null : app.querySelector(k.zone);
  let t = k.id ? document.getElementById(k.id) : null;
  if (!t && zone) t = [...zone.querySelectorAll(k.tag)].find((e) => (e.getAttribute("href") ?? null) === k.href
    && (e.getAttribute("aria-label") || e.textContent).trim() === k.text && !e.disabled);
  if (!t) t = shell.detail.querySelector("h1") || shell.detail;
  if ((t === shell.detail || t.tagName === "H1") && !t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1");
  t.focus({ preventScroll: true });
}

function show(page, { mode, selected } = {}) {
  const focused = focusKey();
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
  restoreFocus(focused);
}

/** For a calculator with a state chosen: where that state's figures come from and what the estimate leaves out. */
function stateNote(calc, vals) {
  if (!calc.fields.some((f) => f.id === "st")) return null;
  let st = null;
  try { st = engine.tax.state(Number(vals.st || 0)); } catch { return null; }
  if (!st) return null;
  const S = engine.tax.states;
  return card(`${st.name} tax data`, null,
    h("p", { class: "callout", style: "margin:0", text: `Source: ${st.verified}. Tax year ${S.taxYear}, checked ${S.verifiedOn}.` }),
    st.notes.length ? h("ul", { class: "callout secondary", style: "margin:6px 0 0;padding-left:18px" }, st.notes.map((n) => h("li", { text: n }))) : null,
    h("p", { class: "caption secondary", style: "margin:6px 0 0", text: S.notes.join(" ") }));
}

/** "What each part means": why the formula works and what each piece does (tools/formula_notes.py). */
function formulaBreakdown(calc, compact) {
  const e = calc.explain;
  if (!e) return null;
  return h("details", { class: "disc formula" + (compact ? " compact" : "") },
    h("summary", { text: "What each part means" }),
    h("div", { class: "disc-body" },
      h("p", { class: "why", text: e.why }),
      h("dl", {}, e.parts.map((p) => [h("dt", { text: p.term }), h("dd", { text: p.meaning })]))));
}
// Printing (Save as PDF) opens every formula breakdown so it appears in the report.
window.addEventListener("beforeprint", () => document.querySelectorAll("details.formula").forEach((d) => { d.dataset.wasOpen = d.open ? "1" : ""; d.open = true; }));
window.addEventListener("afterprint", () => document.querySelectorAll("details.formula").forEach((d) => { d.open = d.dataset.wasOpen === "1"; }));

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
        h("p", { class: "lede", text: "Type in any numbers and watch the results update. Nothing is filled in for you, and nothing you type is saved or sent (Stock research sends only the ticker symbol you look up)." })),
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

// The calculators an advisor reaches for most in a meeting; shown first on the Calculators page.
const FREQUENT = ["retirement_timeline", "retirement_mc", "portfolio_stress", "fee_drag", "rmd", "income_tax", "roth_conversion", "ltcg_tax"];
// Shown last and folded away on the Calculators page (still searchable).
const TUCKED = ["Everyday math"];

// A −100…+100 meter with the ±20 Offense / Defense lines; stretches to the page width.
function scoreMeter(v) {
  const x = (s) => ((Math.min(Math.max(s, -100), 100) + 100) / 200) * 1000;
  const el = h("div", { class: "meter" });
  el.innerHTML = `<svg viewBox="0 0 1000 26" preserveAspectRatio="none" role="img" aria-label="Score ${signed(v)} on a scale from −100 to +100">
    <rect x="0" y="10" width="${x(-20)}" height="6" class="mz-neg"/><rect x="${x(-20)}" y="10" width="${x(20) - x(-20)}" height="6" class="mz-neu"/>
    <rect x="${x(20)}" y="10" width="${1000 - x(20)}" height="6" class="mz-pos"/>
    ${Number.isFinite(v) ? `<rect x="${Math.min(Math.max(x(v) - 2, 0), 996)}" y="0" width="4" height="26" class="mz-mark"/>` : ""}</svg>`;
  el.append(h("div", { class: "meter-ticks" }, [-100, -50, -20, 0, 20, 50, 100].map((t) =>
    h("span", { style: `left:${x(t) / 10}%`, class: t === -100 ? "first" : t === 100 ? "last" : null, text: t === 0 ? "0" : signed(t) }))));
  return el;
}
const shortDay = (iso) => { const d = new Date(iso + "T12:00:00"); return Number.isNaN(+d) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };

function advisorHome() {
  if (data.roro === undefined) loadRoRo().then(() => { if (location.hash === "#/advisor" || location.hash === "#/advisor/") route(); });
  const m = data.roro;
  let brief;
  if (m === undefined) brief = h("p", { class: "secondary", text: "Loading the latest market reading…" });
  else if (!m?.horizons?.length) brief = [h("p", { class: "secondary", text: "The RoRo reading isn't available right now. It is published each weekday after the US close." }),
    h("a", { class: "callout", href: "#/advisor/markets", text: "Treasury yields & quotes" })];
  else {
    const p = m.posture || {}, st = roroStatus(m), band = p.band || "—", t = bandTone(band);
    const spans = { Tactical: "days to weeks", Intermediate: "1–3 months", Strategic: "3–12 months" };
    // The two buckets whose scores changed most since the previous reading (same window as the delta).
    const movers = [...(m.buckets || [])].filter((b) => Number.isFinite(b.wow)).sort((a, b) => Math.abs(b.wow) - Math.abs(a.wow)).slice(0, 2);
    const since = p.prev_date ? shortDay(p.prev_date) : "the last reading";
    brief = [
      h("section", { class: "score", "aria-label": "RoRo Composite" },
        h("div", { class: "big c-" + t, text: signed(p.value) }),
        h("div", {},
          h("div", { class: "band c-" + t, text: band }),
          p.delta !== undefined ? h("div", { class: "delta" }, h("strong", { text: signed(p.delta) }), ` since ${since}`, p.prev !== undefined ? ` (was ${signed(p.prev)})` : "") : null),
        scoreMeter(p.value)),
      h("section", { class: "horizons", "aria-label": "Horizons" }, m.horizons.map((z) => h("div", {},
        h("div", { class: "h-name", text: z.label }), h("div", { class: "h-span", text: spans[z.label] || z.span || "" }),
        h("div", { class: "h-val c-" + tone(z.value) }, signed(z.value), h("span", { text: marketWordFor(z.value) }))))),
      h("div", { class: "brief-lower" },
        h("section", { class: "movers" },
          h("h2", { class: "eyebrow", text: "What moved the score" }),
          movers.length ? h("ol", {}, movers.map((b) => h("li", {},
            h("div", {}, h("strong", { text: b.name }), h("p", { text: `Bucket score ${b.wow < 0 ? "fell" : b.wow > 0 ? "rose" : "held"} to ${signed(b.score)} since ${since}.` })),
            h("div", { class: "pts c-" + (b.wow > 0 ? "pos" : b.wow < 0 ? "neg" : ""), text: signed(b.wow) }))))
            : h("p", { class: "secondary", text: "No bucket changes are available for this reading." }),
          h("a", { class: "callout", href: "#/advisor/roro", text: "All factors, history and methodology" })),
        h("section", { class: "for-client" },
          h("h2", { class: "eyebrow", text: "For the client" }),
          h("p", { text: "The same reading in plain language, without scores or jargon." }),
          h("a", { class: "btn primary big", href: "#/client/market" }, "Show client version ", h("span", { "aria-hidden": "true", text: "→" })),
          h("a", { class: "callout", href: "#/advisor/markets", text: "Treasury yields & quotes" }))),
      h("p", { class: "note", text: `Scale −100 (risk-off) to +100 (risk-on); Offense above +20, Defense below −20. Bucket changes are the change in each bucket's own score; buckets are weighted differently in each horizon. A hand-calibrated model of current conditions, not a forecast of returns. ${st.detail}` }),
    ];
  }
  const st = m?.horizons?.length ? roroStatus(m) : null;
  return {
    title: "Market Brief", subtitle: "Advisor Mode",
    actions: () => [tbtn("refresh", "Reload", async () => { await loadRoRo(true); route(); toast("Reloaded the latest published reading."); }, { help: "Reload the latest published RoRo reading" })],
    body: h("div", { class: "page wide brief2" },
      h("div", { class: "brief-head" }, h("h1", { class: "large", text: "Market Brief" }),
        st ? h("div", { class: "asof" }, `RoRo Composite · as of ${m.asof}`, h("span", { class: "statuspill " + st.cls, text: st.label })) : null),
      brief,
      h("p", { class: "disclosure", text: "Educational calculations. Not investment, tax or legal advice. Independent application; not affiliated with or endorsed by Morgan Stanley." })),
  };
}
const marketWordFor = (v) => (v === null || v === undefined || Number.isNaN(v) ? "" : v >= 20 ? "Offense" : v <= -20 ? "Defense" : "Neutral");

// Every calculator matching a keyword, grouped by category, each with its formula, so a word like
// "medicare" or "tax" pulls up the equations themselves. Click one to open it.
function formulaList(q) {
  const hits = search(q, engine.calculators);
  if (!hits.length) return h("p", { class: "secondary", text: "No calculator matches that. Try a shorter word." });
  const groups = [];
  for (const c of hits) {
    let g = groups.find((x) => x.cat === c.category);
    if (!g) groups.push(g = { cat: c.category, list: [] });
    g.list.push(c);
  }
  return h("div", { class: "formulas" },
    h("p", { class: "secondary", text: `${hits.length} formula${hits.length === 1 ? "" : "s"} for “${q}”` }),
    groups.map((g) => h("section", { class: "fgroup" },
      h("h2", { class: "eyebrow", text: `${g.cat} · ${g.list.length}` }),
      g.list.map((c) => h("a", { class: "frow", href: `#/advisor/${c.id}` },
        h("div", { class: "fhead" }, h("strong", { text: c.name }), c.acronym ? h("span", { class: "acr", text: c.acronym }) : null),
        h("code", { class: "fmath", text: c.math }),
        h("span", { class: "fsum", text: c.summary }))))));
}

function calculatorsPage() {
  const link = (c) => h("a", { href: `#/advisor/${c.id}`, title: c.summary }, h("span", { class: "grow", text: c.name }),
    PRESENT[c.id] ? h("span", { class: "tertiary", title: "Has a Client Mode view", style: "display:inline-flex" }, icon("people")) : null, icon("chevron"));
  const results = h("div");
  const paint = (q) => {
    calcQuery = q;
    if (q.trim()) {
      fill(results, formulaList(q.trim()));
      return;
    }
    const frequent = FREQUENT.map((id) => engine.calculator(id)).filter(Boolean);
    const favs = Prefs.favorites.map((id) => engine.calculator(id)).filter(Boolean);
    const cats = categories(engine.calculators);
    fill(results,
      h("div", { class: "cat" }, h("h2", { text: "Frequently used" }), h("div", { class: "catgrid" }, frequent.map(link))),
      favs.length ? h("div", { class: "cat" }, h("h2", { text: "Favorites" }), h("div", { class: "catgrid" }, favs.map(link))) : null,
      cats.filter((c) => !TUCKED.includes(c)).map((cat) => h("div", { class: "cat" }, h("h2", { text: cat }),
        h("div", { class: "catgrid" }, engine.calculators.filter((c) => c.category === cat).map(link)))),
      cats.filter((c) => TUCKED.includes(c)).map((cat) => h("details", { class: "cat tucked" }, h("summary", {}, h("h2", { text: `${cat} (${engine.calculators.filter((c) => c.category === cat).length})` })),
        h("div", { class: "catgrid" }, engine.calculators.filter((c) => c.category === cat).map(link)))));
  };
  const input = h("input", { type: "search", placeholder: `Type a keyword (medicare, tax, bond…) to list its formulas`, "aria-label": "Search calculators and formulas",
    value: calcQuery, oninput: () => paint(input.value) });
  paint(calcQuery);
  return {
    title: "Calculators", subtitle: "Advisor Mode",
    body: h("div", { class: "page wide" },
      h("div", {}, h("h1", { class: "large", text: "Calculators" }),
        h("p", { class: "secondary", style: "margin:6px 0 0", text: "Every calculator opens blank; type your own numbers. Formulas, assumptions and sources are on each one. The people icon means it can open the matching Client Mode tool with the same numbers (Present to client)." })),
      h("label", { class: "stk-field", style: "max-width:520px" }, icon("search"), input),
      results),
    mounted: () => input.focus(),
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

// Advisor calculators whose inputs carry straight into a Client Mode tool (same field names and units).
const PRESENT = {
  retirement_timeline: { tool: "retirement", key: "client.retirement" },
  retirement_mc: { tool: "retirement", key: "client.retirement" },
  portfolio_stress: { tool: "risk", key: "client.risk" },
  growth_schedule: { tool: "growth", key: "client.growth" },
};
function presentToClient(calc, vals) {
  const p = PRESENT[calc.id];
  const typed = Object.fromEntries(Object.entries(vals).filter(([, v]) => String(v ?? "").trim() !== ""));
  S.client[p.key] = { ...(S.client[p.key] || {}), ...typed };
  location.hash = `#/client/${p.tool}`;
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
    return h("div", { class: "fld" }, h("label", { for: id, text: f.label }), h("div", { class: "ctrl" }, line, hints[f.id], errs[f.id]));
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
      stateNote(calc, vals),
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
      PRESENT[calc.id] ? tbtn("people", "Present to client", () => presentToClient(calc, vals), { help: "Open the Client Mode view with these numbers" }) : null,
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
        h("div", { class: "math", text: calc.math }),
        formulaBreakdown(calc)),
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
// Advisor: Stock research (one ticker). Numbers from stock.js; data through the lookup service.

// GitHub Pages has no server of its own, so it uses the Vercel site's lookup service.
const STOCK_API = location.hostname.endsWith("github.io") ? "https://da-scene.vercel.app/api/stock" : "api/stock";
const RANGES = [["1D", null], ["1M", [1, 0]], ["6M", [6, 0]], ["YTD", "ytd"], ["1Y", [0, 1]], ["5Y", [0, 5]], ["10Y", [0, 10]]];

async function loadTickers() {
  if (data.tickers !== undefined) return;
  try { data.tickers = await loadJSON(`${STOCK_API}?list=tickers`); } catch { data.tickers = null; }
}
function tickerMatches(q) {
  const t = data.tickers;
  if (!t || !q) return [];
  const Q = q.toUpperCase(), out = [];
  if (t[Q]) out.push(Q);
  for (const k in t) { if (out.length >= 8) break; if (k !== Q && k.startsWith(Q)) out.push(k); }
  if (out.length < 8 && Q.length >= 3) for (const k in t) { if (out.length >= 8) break; if (!out.includes(k) && t[k][1].toUpperCase().includes(Q)) out.push(k); }
  return out;
}
async function lookupStock(sym) {
  sym = sym.trim().toUpperCase().replace(/\./g, "-");
  if (!sym) return;
  S.stock = { symbol: sym, loading: true, range: S.stock?.range || "1Y", vsBench: S.stock?.vsBench ?? true, studies: S.stock?.studies };
  route();
  await loadTickers();
  const cik = data.tickers?.[sym]?.[0];
  try {
    const r = await fetch(`${STOCK_API}?t=${encodeURIComponent(sym)}${cik ? `&cik=${cik}` : ""}`, { cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `The lookup service answered ${r.status}.`);
    S.stock = { ...S.stock, _studyCache: {}, loading: false, result: analyze(body), noFacts: !body.facts, factsError: body.factsError, inMap: !!cik };
  } catch (e) {
    S.stock = { ...S.stock, loading: false, error: e.message === "Failed to fetch" ? "Couldn't reach the lookup service. Check the connection and try again." : e.message };
  }
  if (location.hash === "#/advisor/stock") route();
}

const pct1 = (v) => (v === null || v === undefined ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`);
const pct2 = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
const mult = (v) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}×`);
const money2 = (v) => (v === null || v === undefined ? "—" : Format.plain(v, 2));
const big = (v) => (v === null || v === undefined ? "—" : Math.abs(v) >= 1e12 ? `${v < 0 ? "−" : ""}$${(Math.abs(v) / 1e12).toFixed(2)}T` : Format.compact(v));
const monthYear = (d) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const shortDate = (d, withYear) => {
  if (!d) return "";
  const t = new Date(d + "T00:00:00Z");
  return withYear ? `${t.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ’${String(t.getUTCFullYear()).slice(2)}`
    : t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
const longDate = (d) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

function stockSearch() {
  const input = h("input", { type: "search", placeholder: "Ticker symbol, e.g. AAPL", value: S.stock?.symbol || "", "aria-label": "Ticker symbol",
    autocomplete: "off", spellcheck: "false", style: "text-transform:uppercase" });
  const list = h("div", { class: "stk-suggest", role: "listbox" });
  const paint = () => fill(list, tickerMatches(input.value.trim()).map((k) => h("button", { role: "option", onclick: () => { input.value = k; list.replaceChildren(); lookupStock(k); } },
    h("strong", { text: k }), h("span", { text: data.tickers[k][1] }))));
  input.addEventListener("input", () => { if (data.tickers === undefined) loadTickers().then(paint); else paint(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { list.replaceChildren(); lookupStock(input.value); } if (e.key === "Escape") list.replaceChildren(); });
  return h("div", { class: "stk-search" },
    h("label", { class: "stk-field" }, icon("search"), input),
    h("button", { class: "btn primary", text: "Look up", onclick: () => { list.replaceChildren(); lookupStock(input.value); } }),
    list);
}

function priceChartCard(r) {
  const st = S.stock, A = cssVar("--accent"), G = cssVar("--secondary");
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Chart range" }, RANGES.map(([k]) =>
    h("button", { class: st.range === k ? "on" : null, text: k, onclick: () => { S.stock.range = k; route(); } })));
  let body;
  if (st.range === "1D") {
    const pts = r.intraday;
    body = pts.length < 2 ? h("div", { class: "secondary", text: "No trading yet today." }) :
      chart("line", { labels: pts.map(([t]) => new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })),
        datasets: [{ label: r.symbol, data: pts.map((p) => p[1]), borderColor: A, backgroundColor: A, borderWidth: 2 }] },
      { legend: false, zero: false, money: false, maxXTicks: 6, label: `${r.symbol} today`, tooltip: (c) => `${r.symbol}: ${money2(c.parsed.y)}`,
        lines: r.quote.prevClose ? { y: [{ value: r.quote.prevClose, color: rgba(cssVar("--neutral"), 0.7) }] } : {} });
  } else {
    const days = r.chart.days, last = days[days.length - 1], spec = RANGES.find(([k]) => k === st.range)[1];
    let from;
    if (spec === "ytd") from = `${Number(last.slice(0, 4)) - 1}-12-31`;
    else { const d = new Date(last + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - spec[0] - 12 * spec[1]); from = d.toISOString().slice(0, 10); }
    let i0 = days.findIndex((d) => d >= from); if (i0 > 0 && days[i0] > from) i0--; if (i0 < 0) i0 = 0;
    const idx = days.slice(i0).map((_, j) => i0 + j);
    const step = Math.max(1, Math.floor(idx.length / 600));
    const pick = idx.filter((_, j) => j % step === 0 || j === idx.length - 1);
    const labels = pick.map((i) => days[i]);  // ISO dates; shown short on the axis, in full in the tooltip
    let datasets, o, readout = null;
    if (st.vsBench) {
      const bm = new Map(r.chart.bench);
      const base = r.chart.adj[pick[0]], bBase = bm.get(days[pick[0]]);
      datasets = [{ label: r.symbol, data: pick.map((i) => (r.chart.adj[i] / base) * 100), borderColor: A, backgroundColor: A, borderWidth: 2 },
        bBase ? { label: "S&P 500 (SPY)", data: pick.map((i) => (bm.has(days[i]) ? (bm.get(days[i]) / bBase) * 100 : null)), borderColor: G, backgroundColor: G, borderWidth: 1.5, spanGaps: true } : null].filter(Boolean);
      o = { money: false, zero: false, maxXTicks: 8, label: `${r.symbol} against the S&P 500, growth of 100`, tooltip: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)}`,
        lines: { y: [{ value: 100, color: rgba(cssVar("--neutral"), 0.6) }] } };
    } else {
      const on = st.studies || {}, c = r.chart.close, at = (arr) => pick.map((i) => arr[i]);
      const study = (st._studyCache ||= {});
      const get = (k, f) => (study[k] ||= f());
      datasets = [{ label: r.symbol, data: at(c), borderColor: A, backgroundColor: A, borderWidth: 2.2, order: 1 }];
      if (on.bb) {
        const bb = get("bb", () => bollinger(c, 20, 2)), N = cssVar("--neutral");
        datasets.push({ label: "Bollinger bands", data: at(bb.up), borderColor: rgba(N, 0.45), backgroundColor: rgba(N, 0.45), borderWidth: 1, order: 3 },
          { label: "Bollinger lower", data: at(bb.lo), borderColor: rgba(N, 0.45), borderWidth: 1, fill: "-1", backgroundColor: rgba(N, 0.07), order: 3 });
      }
      if (on.ma50) datasets.push({ label: "50-day average", data: at(get("ma50", () => sma(c, 50))), borderColor: cssVar("--orange"), backgroundColor: cssVar("--orange"), borderWidth: 1.5, order: 2 });
      if (on.ma200) datasets.push({ label: "200-day average", data: at(get("ma200", () => sma(c, 200))), borderColor: cssVar("--blue"), backgroundColor: cssVar("--blue"), borderWidth: 1.5, order: 2 });
      const fibs = on.fib ? fibLevels(idx.map((i) => c[i])) : [];
      o = { money: false, zero: false, legend: false, maxXTicks: 8, label: `${r.symbol} price`,
        tooltip: (x) => (x.dataset.label === "Bollinger lower" ? `Bollinger lower: ${money2(x.parsed.y)}` : x.dataset.label === "Bollinger bands" ? `Bollinger upper: ${money2(x.parsed.y)}` : `${x.dataset.label}: ${money2(x.parsed.y)}`),
        padRight: fibs.length ? 104 : 0,
        lines: { y: fibs.map((f) => ({ value: f.price, color: rgba(cssVar("--neutral"), 0.45), label: `${(f.ratio * 100).toFixed(1).replace(".0", "")}%  ${money2(f.price)}` })) } };
      // One line of plain numbers above the chart: today's close and the latest value of each study.
      const L = c.length - 1, pct = (a, b) => `${a >= b ? "+" : "−"}${Math.abs((a / b - 1) * 100).toFixed(1)}%`;
      const chip = (color, name, value, note) => h("span", { class: "rd" }, h("i", { style: `background:${color}` }), h("b", { text: name }), ` ${value}`, note ? h("em", { text: ` ${note}` }) : null);
      readout = h("div", { class: "readout" },
        chip(A, "Close", money2(c[L])),
        on.ma50 && study.ma50[L] !== null ? chip(cssVar("--orange"), "50-day avg", money2(study.ma50[L]), `price ${pct(c[L], study.ma50[L])} vs. average`) : null,
        on.ma200 && study.ma200[L] !== null ? chip(cssVar("--blue"), "200-day avg", money2(study.ma200[L]), `price ${pct(c[L], study.ma200[L])} vs. average`) : null,
        on.bb && study.bb.lo[L] !== null ? chip(rgba(cssVar("--neutral"), 0.6), "Bollinger", `${money2(study.bb.lo[L])} – ${money2(study.bb.up[L])}`) : null,
        on.fib && fibs.length ? chip(rgba(cssVar("--neutral"), 0.6), "Range", `${money2(fibs[fibs.length - 1].price)} – ${money2(fibs[0].price)}`, "low – high of the period shown") : null);
    }
    const anyStudy = !st.vsBench && Object.values(st.studies || {}).some(Boolean);
    const longSpan = idx.length > 400, xFormat = (d) => shortDate(d, longSpan);
    body = [readout, chart("line", { labels, datasets }, { ...o, xFormat, tooltipTitle: longDate, size: anyStudy ? "h340" : undefined })];
    if (!st.vsBench && st.studies?.rsi) {
      const rv = (st._studyCache.rsi ||= rsi(r.chart.close, 14));
      body.push(h("div", { class: "caption secondary", style: "margin-top:4px", text: `RSI (14 days): ${rv[rv.length - 1] === null ? "—" : rv[rv.length - 1].toFixed(0)} now. Shaded band is 30 to 70.` }),
        chart("line", { labels, datasets: [{ label: "RSI (14)", data: pick.map((i) => rv[i]), borderColor: cssVar("--accent"), borderWidth: 1.5 }] },
          { size: "h110", legend: false, money: false, zero: false, yMin: 0, yMax: 100, maxXTicks: 8, label: `${r.symbol} 14-day RSI`,
            xFormat, tooltipTitle: longDate, padRight: o.padRight,
            yTicks: { color: cssVar("--secondary"), stepSize: 50 }, tooltip: (x) => `RSI: ${x.parsed.y.toFixed(1)}`,
            lines: { band: { from: 30, to: 70, color: rgba(cssVar("--neutral"), 0.08) },
              y: [{ value: 70, color: rgba(cssVar("--neutral"), 0.5), label: "70" }, { value: 30, color: rgba(cssVar("--neutral"), 0.5), label: "30" }] } }));
    }
  }
  const STUDIES = [["ma50", "50-day average"], ["ma200", "200-day average"], ["bb", "Bollinger bands"], ["fib", "Fibonacci levels"], ["rsi", "RSI"]];
  const studyBar = st.range === "1D" ? null : h("div", { class: "studies", role: "group", "aria-label": "Chart studies" },
    STUDIES.map(([k, label]) => h("label", { class: "study" + (st.studies?.[k] ? " on" : "") },
      h("input", { type: "checkbox", checked: !!st.studies?.[k], onchange: (e) => {
        S.stock.studies = { ...(S.stock.studies || {}), [k]: e.target.checked };
        if (e.target.checked) S.stock.vsBench = false;
        route();
      } }), label)));
  return card("Price", h("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" },
    st.range === "1D" ? null : h("label", { class: "caption secondary", style: "display:flex;gap:6px;align-items:center" },
      h("input", { type: "checkbox", checked: st.vsBench, onchange: (e) => { S.stock.vsBench = e.target.checked; route(); } }), "Compare with S&P 500"),
    seg), studyBar, body,
  h("div", { class: "caption tertiary", text: st.range === "1D" ? "Today, 5-minute prices; the dashed line is yesterday's close."
    : st.vsBench ? "Growth of 100 with dividends reinvested, for the stock and SPY (an S&P 500 fund). Turn this off to add chart studies."
    : "Closing prices, adjusted for splits. Studies: moving averages of daily closes; Bollinger bands are the 20-day average ± 2 standard deviations; Fibonacci levels are measured down from the highest to the lowest close in the range shown; RSI (14) uses Wilder's smoothing. They describe past prices and don't predict where the price will go." }));
}

function stockPage() {
  const st = S.stock;
  const head = h("div", {}, h("h1", { class: "large", text: "Stock research" }),
    h("p", { class: "callout secondary", style: "margin:4px 0 0", text: "One company at a time: price history, risk, fundamentals from SEC filings, valuation and filings. Facts and history only. No ratings, targets or recommendations." }));
  const privacy = h("p", { class: "note", text: "Looking up a symbol sends only that symbol to Wealth Desk's lookup service, which fetches public data from Yahoo Finance and the SEC and sends it back. Nothing is saved; the result stays in this tab's memory until you clear the session or close it." });
  let content = [];
  if (!st) content = [unavailable("search", "Look up a stock", "Type a ticker symbol above. Suggestions come from the SEC's list of listed companies.")];
  else if (st.loading) content = [h("div", { class: "secondary", text: `Looking up ${st.symbol}…` })];
  else if (st.error) content = [unavailable("warn", `Couldn't look up ${st.symbol}`, st.error)];
  else content = stockResult(st.result, st);
  return {
    title: "Stock research", subtitle: st?.result ? `${st.result.symbol} · ${st.result.name || ""}` : "",
    actions: () => [st?.result ? tbtn("refresh", "Refresh", () => lookupStock(st.symbol), { help: "Fetch the latest data again" }) : null,
      tbtn("doc", "PDF", () => { st?.result ? window.print() : toast("Look up a stock first."); }, { help: "Print, or choose Save as PDF in the print dialog" })].filter(Boolean),
    body: h("div", { class: "page wide" }, printHead("Stock research", st?.result?.symbol || ""), head, stockSearch(), ...content, privacy),
  };
}

function stockResult(r, st) {
  const q = r.quote, v = r.valuation, rk = r.risk, dv = r.dividends;
  const up = (q.change ?? 0) >= 0;
  const fin = r.company && /bank|insur|financ|savings|credit|reit|real estate invest/i.test(r.company.sic || "");
  const pos52 = q.high52 && q.low52 && q.high52 > q.low52 ? Math.min(1, Math.max(0, (q.price - q.low52) / (q.high52 - q.low52))) : null;

  const quote = h("section", { class: "card stk-quote" },
    h("div", { class: "stk-q1" },
      h("div", {}, h("div", { class: "stk-sym", text: r.symbol }), h("div", { class: "secondary", text: [r.name, r.exchange, r.company?.sic].filter(Boolean).join(" · ") })),
      h("div", { style: "text-align:right" }, h("div", { class: "stk-px tnum", text: money2(q.price) + (r.currency !== "USD" ? " " + r.currency : "") }),
        h("div", { class: "tnum " + (up ? "up" : "down"), text: q.change === null ? "" : `${up ? "+" : "−"}${Math.abs(q.change).toFixed(2)} (${pct2(Math.abs(q.changePct)).replace(/^/, up ? "+" : "−")}) today` }))),
    pos52 === null ? null : h("div", { class: "stk-52" }, h("span", { class: "caption secondary tnum", text: `52-week low ${money2(q.low52)}` }),
      h("div", { class: "stk-52bar" }, h("i", { style: `left:${pos52 * 100}%` })), h("span", { class: "caption secondary tnum", text: `high ${money2(q.high52)}` })),
    h("div", { class: "stk-kv" },
      kv("Market value", big(v.marketCap)), kv("P/E (trailing)", mult(v.pe)), kv("Dividend yield", pct2(v.divYield)),
      kv("1-year return", pct1(r.returns.find((x) => x.key === "1Y")?.stock)), kv("Beta (5 years)", rk.beta5y === null ? "—" : rk.beta5y.toFixed(2))),
    h("div", { class: "caption tertiary", text: `Delayed quote, last trading day ${longDate(q.lastDay)}. Market value = price × shares outstanding from the latest filing${r.balance.sharesAsOf ? ` (${longDate(r.balance.sharesAsOf)})` : ""}.` }));

  const returns = card("Returns", h("span", { class: "caption secondary", text: "Dividends reinvested · 3, 5 and 10 years are per year" }),
    h("div", { class: "scrollx" }, h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, h("th", { class: "l", text: "" }), r.returns.map((x) => h("th", { text: x.key })))),
      h("tbody", {},
        h("tr", {}, h("td", { class: "l", text: r.symbol }), r.returns.map((x) => h("td", { class: x.stock === null ? "" : x.stock >= 0 ? "up" : "down", text: pct1(x.stock) }))),
        h("tr", {}, h("td", { class: "l secondary", text: "S&P 500 (SPY)" }), r.returns.map((x) => h("td", { class: "secondary", text: pct1(x.bench) }))),
        h("tr", {}, h("td", { class: "l secondary", text: "Difference" }), r.returns.map((x) => h("td", { class: "secondary", text: x.stock === null || x.bench === null ? "—" : pct1(x.stock - x.bench) })))))));

  const risk = card("Risk", null, h("div", { class: "spreads stk-tiles" },
    tileV("Volatility, last year", pct1(rk.vol1y).replace("+", ""), `S&P 500: ${pct1(rk.benchVol1y).replace("+", "")}`),
    tileV("Beta (5 years, monthly)", rk.beta5y === null ? "—" : rk.beta5y.toFixed(2), rk.beta5y === null ? `Needs 24 months (has ${rk.betaMonths})` : `${rk.betaMonths} months against SPY`),
    tileV("Largest fall (10 years)", rk.maxDD === undefined ? "—" : "−" + (rk.maxDD * 100).toFixed(1) + "%", rk.peakDay ? `${monthYear(rk.peakDay)} to ${monthYear(rk.troughDay)}; ${rk.recoveryDay ? "back by " + monthYear(rk.recoveryDay) : "not yet recovered"}` : ""),
    tileV("Below its 10-year high", rk.currentDD === undefined ? "—" : (rk.currentDD < 0.0005 ? "At the high" : "−" + (rk.currentDD * 100).toFixed(1) + "%"), "Dividends reinvested")),
    h("div", { class: "caption tertiary", text: "Volatility: how much daily returns swing, per year. Beta: how much the stock has tended to move when the S&P 500 moves 1%. Both describe the past, not the future." }));

  const T = { overview: [quote, priceChartCard(r), returns, risk], financials: [], valuation: [], filings: [] };
  let out = T.financials;

  if (!r.annual.length) {
    T.valuation.push(card("Fundamentals", null, h("p", { class: "secondary", text: st.inMap === false
      ? "This symbol isn't on the SEC's list of operating companies (funds and many foreign companies aren't), so only price data is shown."
      : st.factsError || (data.tickers === null ? "The SEC's company list couldn't be loaded, so fundamentals aren't shown." : "The SEC has no financial statements in XBRL for this company.") })));
  } else {
    const med = v.medians;
    const vt = (label, now, m, fmt, note) => tileV(label, fmt(now), m === null || m === undefined ? note || "No 10-year median" : `10-year median ${fmt(m)}`);
    T.valuation.push(card("Company size", null, h("div", { class: "stk-kv" },
      kv("Market value", big(v.marketCap)), kv("Enterprise value", fin ? "n/m" : big(v.ev)), kv("Cash", big(r.balance.cash)), kv("Long-term debt", big(r.balance.debt)),
      kv("Shares outstanding", r.balance.sharesOut ? (r.balance.sharesOut / 1e9).toFixed(2) + "B" : "—")),
      h("div", { class: "caption tertiary", text: `Enterprise value = market value + long-term debt − cash, from the latest balance sheet${r.balance.cashAsOf ? ` (${longDate(r.balance.cashAsOf)})` : ""}.` })));
    T.valuation.push(card("Valuation", h("span", { class: "caption secondary", text: `Trailing 12 months through ${longDate(r.ttm.epsThrough || r.ttm.revenueThrough)}` }),
      h("div", { class: "spreads stk-tiles" },
        vt("Price / earnings", v.pe, med.pe, mult, r.ttm.eps !== null && r.ttm.eps <= 0 ? "Earnings negative, so n/m" : null),
        vt("Price / sales", v.ps, med.ps, mult),
        tileV("Price / book", mult(v.pb), "Book = shareholders' equity"),
        fin ? tileV("EV / EBITDA", "n/m", "Not meaningful for banks and insurers") : vt("EV / EBITDA", v.evEbitda, med.evEbitda, mult),
        fin ? tileV("Free cash flow yield", "n/m", "Not meaningful for banks and insurers") : vt("Free cash flow yield", v.fcfYield, med.fcfYield, pct2),
        tileV("Dividend yield", pct2(v.divYield), dv.growth5 === null ? "No 5-year dividend growth" : `Dividend grew ${pct1(dv.growth5).replace("+", "")} a year over 5 years`)),
      h("div", { class: "caption tertiary", text: "Medians use each fiscal year-end's share price with that year's results. Today's figures use the latest price with trailing-12-month results. History is context, not a sign of what comes next." })));

    const A = cssVar("--accent"), G = cssVar("--secondary");
    out.push(card("Revenue and earnings", h("span", { class: "caption secondary", text: r.growth.revenueCAGR === null ? "" : `Revenue ${pct1(r.growth.revenueCAGR).replace("+", "")} a year · EPS ${r.growth.epsCAGR === null ? "—" : pct1(r.growth.epsCAGR).replace("+", "")} a year over ${r.growth.years.toFixed(0)} years` }),
      chart("bar", { labels: r.annual.map((x) => monthYear(x.end)), datasets: [
        { label: "Revenue", data: r.annual.map((x) => x.revenue), backgroundColor: rgba(A, 0.85) },
        { label: "Net income", data: r.annual.map((x) => x.netIncome), backgroundColor: rgba(G, 0.7) }] },
      { label: "Revenue and net income by fiscal year", tooltip: (c) => `${c.dataset.label}: ${big(c.parsed.y)}` })));

    const rows = [
      ["Revenue", "revenue", big], ["Revenue growth", "revGrowth", pct1], ["Gross margin", "grossMargin", pct2], ["Operating income", "opIncome", big],
      ["Operating margin", "opMargin", pct2], ["Net income", "netIncome", big], ["Net margin", "netMargin", pct2], ["Diluted EPS", "eps", money2],
      ["EPS growth", "epsGrowth", pct1], ["Operating cash flow", "ocf", big], ["Capital spending", "capex", big], ["Free cash flow", "fcf", big],
      ["FCF margin", "fcfMargin", pct2], ["Diluted shares", "shares", (x) => (x === null ? "—" : (x / 1e9).toFixed(2) + "B")],
      ["Cash", "cash", big], ["Long-term debt", "debt", big], ["Shareholders' equity", "equity", big], ["Dividends per share", "dps", money2],
      ["Year-end price", "price", money2], ["P/E at year end", "pe", mult], ["P/S at year end", "ps", mult],
    ];
    const ttmCol = { revenue: r.ttm.revenue, opIncome: r.ttm.opIncome, netIncome: r.ttm.netIncome, eps: r.ttm.eps, ocf: r.ttm.ocf, capex: r.ttm.capex, fcf: r.ttm.fcf };
    out.push(card("Financial statements", h("span", { class: "caption secondary", text: "Fiscal years from 10-K filings · per-share figures on today's share basis" }),
      h("div", { class: "scrollx" }, h("table", { class: "grid stk-fin" },
        h("thead", {}, h("tr", {}, h("th", { class: "l", text: "" }), r.annual.map((x) => h("th", { text: monthYear(x.end) })), h("th", { text: "TTM" }))),
        h("tbody", {}, rows.map(([label, k, f]) => h("tr", {}, h("td", { class: "l", text: label }),
          r.annual.map((x) => h("td", { text: f(x[k]) })), h("td", { class: "secondary", text: k in ttmCol ? f(ttmCol[k]) : "" })))))),
      h("div", { class: "caption tertiary", text: "Each figure is the most recently filed value for that period, so restated numbers replace originals. TTM = last fiscal year + this year to date − the same period last year. Blank (—) means the company doesn't report that line in a standard form." })));
  }

  if (!r.annual.length) T.financials.push(T.valuation[0]);
  if (r.filings.length) T.filings.push(card("Recent SEC filings", null, h("div", { class: "stk-filings" }, r.filings.map((f) =>
    h("a", { href: f.url, target: "_blank", rel: "noopener noreferrer" }, h("span", { class: "tnum secondary", text: longDate(f.date) }), h("strong", { text: f.form }),
      h("span", { class: "grow", text: f.description === f.form ? "" : f.description }), icon("chevron")))),
    h("div", { class: "caption tertiary", text: "Opens the filing on sec.gov." })));

  const pctField = (x) => (x === null || x === undefined ? undefined : Format.plain(x * 100, 2));
  const send = (id, label, vals) => h("button", { class: "btn", text: label, onclick: () => openCalculator(id, Object.fromEntries(Object.entries(vals).filter(([, x]) => x !== undefined))) });
  const r5 = r.returns.find((x) => x.key === "5Y")?.stock;
  out = T.overview;
  out.push(card("Use these numbers in a calculator", null,
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
      send("position_pl", "Position gain/loss", { price: Format.plain(q.price, 4) }),
      send("position_size", "Position sizing", { price: Format.plain(q.price, 4) }),
      dv.ttm > 0 ? send("ddm", "Dividend discount model", { d0: Format.plain(dv.ttm, 4), price: Format.plain(q.price, 4) }) : null,
      dv.yield > 0 ? send("dividend_income", "Dividend income growth", { y: pctField(dv.yield), g: pctField(dv.growth5) }) : null,
      rk.beta5y !== null ? send("capm", "CAPM expected return", { b: Format.plain(rk.beta5y, 3) }) : null,
      r5 !== null && rk.vol1y !== null ? send("sharpe", "Sharpe ratio", { r: pctField(r5), sd: pctField(rk.vol1y) }) : null),
    h("div", { class: "caption tertiary", text: "Fills in what's known from this stock (price, dividend, beta, past return and volatility). Past growth and returns are filled in only as a starting point; change them to your own assumptions." })));

  const m = data.roro;
  if (m) {
    const sum = clientMarketSummary(m);
    if (sum) out.push(card("Market backdrop", h("a", { class: "callout", href: "#/advisor/roro", text: "RoRo Composite" }),
      h("p", { class: "secondary", style: "margin:0", text: `${sum.headline} This describes overall market conditions, not this stock, and it doesn't predict returns.` })));
  }

  if (!T.filings.length) T.filings.push(card("Recent SEC filings", null, h("p", { class: "secondary", text: "No SEC filings are available for this symbol." })));
  const tabs = [["overview", "Overview"], ["financials", "Financials"], ["valuation", "Valuation"], ["filings", "Filings"]];
  const tab = T[st.tab] ? st.tab : "overview";
  const result = [h("div", { class: "seg wide stk-tabs", role: "tablist", "aria-label": "Stock research sections" }, tabs.map(([k, label]) =>
    h("button", { role: "tab", "aria-selected": String(tab === k), class: tab === k ? "on" : null, text: label, onclick: () => { S.stock.tab = k; route(); } }))),
    ...T[tab]];
  out = result;
  out.push(h("p", { class: "note", text: `Sources: prices, dividends and splits from Yahoo Finance's chart feed (unofficial and unlicensed; quotes are delayed). Financial statements and filings from SEC EDGAR (official XBRL company facts and filing index). S&P 500 comparison uses SPY, an exchange-traded fund that tracks it. Figures can contain errors in the source data. This is factual information for education and discussion, not a recommendation to buy, sell or hold any security.` }));
  return out;
}
const kv = (k, v) => h("div", {}, h("div", { class: "caption secondary", text: k }), h("div", { class: "tnum stk-kvv", text: v }));
const tileV = (t, v, sub) => h("div", { class: "sptile" }, h("div", { class: "callout secondary", text: t }), h("div", { class: "v", text: v }), sub ? h("div", { class: "caption secondary", text: sub }) : null);

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
        ["tactical", "Tactical", rgba(cssVar("--neutral"), 0.7), 1.1],
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
    F("wd", "Taken out each month", 0, 20000, 100, "0"),
    F("r", "Yearly return", 0, 12, 0.25), F("y", "Years", 1, 50, 1), F("infl", "Inflation", 0, 8, 0.25, "0")],
  retirementYou: [F("age", "Age today", 18, 90, 1), F("retire", "Retirement age", 40, 80, 1),
    F("bal", "Invested today", 0, 5e6, 10000, "0"), F("c", "Saved per year until retirement", 0, 200000, 1000, "0"),
    F("spend", "Yearly spending in retirement (today's dollars)", 0, 500000, 5000),
    F("other", "Other yearly retirement income (Social Security, pension)", 0, 200000, 1000, "0")],
  retirementAssumptions: [F("rpre", "Yearly return before retirement", 0, 12, 0.25), F("rpost", "Yearly return in retirement", 0, 12, 0.25),
    F("infl", "Inflation", 0, 8, 0.25), F("plan", "Plan through age", 70, 110, 1, "95"),
    F("oage", "Other income starts at age", 55, 75, 1, "67"), F("cg", "Yearly increase in saving", 0, 10, 0.5, "0"),
    F("wtax", "Tax rate on withdrawals (0 for Roth or after-tax money)", 0, 50, 1, "0"),
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
  medicare: [F("magi", "Income two years ago (modified AGI)", 0, 2e6, 5000), F("status", "Tax return", 1, 2, 1), F("n", "People on Medicare", 1, 2, 1),
    F("plan", "Drug plan premium per person", 0, 500, 5, "0")],
  medicarePenalty: [F("mb", "Months you could have had Part B but didn't", 0, 240, 1, "0"), F("md", "Months without drug coverage", 0, 240, 1, "0")],
};
Spec.retirement = [...Spec.retirementYou, ...Spec.retirementAssumptions];

const TOOLS = [
  { id: "growth", title: "How much could I save?" },
  { id: "retirement", title: "Am I on track for retirement?" },
  { id: "risk", title: "What if markets fall?" },
  { id: "decisions", title: "Compare two plans" },
  { id: "taxes", title: "Taxes & purchasing power" },
  { id: "market", title: "Market brief" },
  { id: "medicare", title: "Going on Medicare" },
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
// Optional inputs, folded under "More assumptions"; open when any of them has a value.
function more(key, fields, note, ...kids) {
  const d = h("details", { class: "igroup more" }, h("summary", { class: "cap-title", text: "More assumptions" }), note ? h("p", { class: "note", text: note }) : null, ...kids);
  d.open = fields.some((f) => String(raw(key, f.id)).trim() !== "");
  return d;
}
const group = (title, note, ...kids) => h("div", { class: "igroup" }, h("p", { class: "cap-title", text: title }), note ? h("p", { class: "note", text: note }) : null, ...kids);
const headline = (text, cap) => h("div", { class: "headline" }, h("div", { class: "big", text }), cap ? h("div", { class: "cap", text: cap }) : null);
const stat = (label, value, cap, neg) => h("div", { class: "stat" }, h("div", { class: "lbl", text: label }),
  h("div", { class: "val" + (neg ? " neg" : ""), text: value, title: value }), cap ? h("div", { class: "cp", text: cap }) : null);
const stats = (...k) => h("div", { class: "stats" }, ...k);
const chartCard = (title, note, ...kids) => h("section", { class: "card" }, h("h3", { class: "chart-title", text: title }), ...kids, note ? h("p", { class: "note", text: note }) : null);
const footnote = () => h("p", { class: "footnote", text: "These are educational illustrations based only on the numbers typed in. They are not advice, a recommendation or a prediction. Nothing typed here is saved or sent; it is erased when this tab closes." });
function needsInput(c) {
  if (!c) return h("div", { class: "needs secondary", text: "This tool is unavailable." });
  return h("div", { class: "needs" }, c.problems.map((p) => h("div", { class: "prob" }, icon("warn"), p)),
    c.missing.length ? [h("h3", { text: "To see the picture, fill in:" }), c.missing.map((x) => h("div", { class: "miss", text: x }))] : null);
}
function howItWorks(calcs) {
  return h("details", { class: "how disc" }, h("summary", { text: "How this is calculated, and what it assumes" }),
    calcs.map((c) => h("div", { class: "how-item" }, h("h4", { text: c.calc.name }), h("code", { text: c.calc.math }), formulaBreakdown(c.calc, true),
      h("p", { text: c.calc.assumptions }), h("p", { text: c.calc.interpretation }),
      h("button", { class: "link no-print", style: "align-self:flex-start;font-size:12px", text: "Open the full calculator in Advisor Mode",
        onclick: () => { S.working[c.calc.id] = { ...c.inputs }; location.hash = `#/advisor/${c.calc.id}`; } }))));
}

let clientCalcs = () => [];   // the calculators behind the open tool, for the PDF report check

// Client home: six questions in two columns, separated by thin rules. No icons or blurbs, so the
// questions themselves are what the client reads.
function clientHome() {
  return {
    title: "Wealth Desk", subtitle: "Client Mode",
    body: h("div", { class: "ptools-page" },
      h("h1", { text: "Planning tools" }),
      h("nav", { class: "ptools", "aria-label": "Planning tools" }, TOOLS.map((t) => h("a", { href: `#/client/${t.id}` },
        h("span", { class: "lbl", text: t.title }), h("span", { class: "arr", "aria-hidden": "true", text: "→" })))),
      footnote()),
  };
}
const crumb = () => h("a", { class: "crumb no-print", href: "#/client" }, h("span", { "aria-hidden": "true", text: "←" }), " Planning tools");

function toolPage(tool, inputPanel, renderResults, calcsForReport) {
  const results = h("div", { class: "tool-out-inner" });
  const refresh = () => schedule(() => {
    destroyCharts();
    fill(results, printHead("Client illustration", tool.title), h("h1", { class: "serif", text: tool.title }), renderResults(), footnote());
    mountCharts(results);
  });
  const panel = h("aside", { class: "tool-in" });
  const refill = () => fill(panel, crumb(), inputPanel(refresh, refill));
  refill();
  clientCalcs = calcsForReport;
  return {
    title: tool.title, subtitle: "Client Mode",
    actions: () => [
      tbtn("doc", "PDF report", () => { clientCalcs().some((c) => c?.ok) ? window.print() : toast("Nothing to report yet. Fill in the numbers first."); },
        { help: "Print, or choose Save as PDF in the print dialog" }),
      tbtn("eraser", "Clear", clearSession, { help: "Erase everything typed this session" }),
    ],
    body: h("div", { class: "tool" }, panel, h("section", { class: "tool-out" }, results)),
    mounted: refresh,
  };
}

// "How much could I save?": compact inputs on the left, one plain-sentence answer and a monthly
// balance chart on the right. Totals come from the audited growth_schedule calculator; the chart
// and the month the money runs out come from the same month-by-month rule (growth, then the
// deposit, then the withdrawal, never below zero), cross-checked against the calculator's totals.
let growthWdOpen = false;
const GKEY = "client.growth";
const YEAR_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const yearsWord = (n) => (n <= 10 ? YEAR_WORDS[n] : String(n)) + (n === 1 ? " year" : " years");
const usd0 = (v) => (v < 0 ? "−" : "") + "$" + Math.round(Math.abs(v)).toLocaleString("en-US");

function growthMonths(p, m, r, years, wd) {
  const i = r / 12, n = years * 12, bal = [p];
  let b = p, withdrawn = 0, shortfall = false, firstZero = null;
  for (let k = 1; k <= n; k++) {
    const avail = Math.max(0, b * (1 + i) + m);
    const take = Math.min(wd, avail);
    if (take < wd) shortfall = true;
    withdrawn += take; b = avail - take;
    if (wd > 0 && b <= 0.005 && firstZero === null) firstZero = k;
    bal.push(b);
  }
  return { bal, end: b, withdrawn, months: n, runOut: shortfall ? firstZero : null };
}

// A $-amount box that keeps thousands separators while typing.
function moneyBox(key, id, label, suffix, on, autofocus) {
  const fid = `in-${key}-${id}`.replace(/\W/g, "_");
  const fmt = (s) => {
    const clean = s.replace(/[^0-9.]/g, ""), dot = clean.indexOf(".");
    const intPart = (dot < 0 ? clean : clean.slice(0, dot)).replace(/^0+(?=\d)/, "");
    const dec = dot < 0 ? "" : "." + clean.slice(dot + 1).replace(/\./g, "").slice(0, 2);
    return (intPart ? Number(intPart).toLocaleString("en-US") : (dec ? "0" : "")) + dec;
  };
  const input = h("input", { type: "text", id: fid, inputmode: "decimal", autocomplete: "off", placeholder: "0", value: fmt(String(raw(key, id))),
    oninput: () => {
      const caretDigits = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/[^0-9.]/g, "").length;
      const v = fmt(input.value);
      input.value = v; setRaw(key, id, v);
      let pos = 0, seen = 0;
      while (pos < v.length && seen < caretDigits) { if (/[0-9.]/.test(v[pos])) seen++; pos++; }
      input.setSelectionRange(pos, pos);
      on();
    } });
  if (autofocus) requestAnimationFrame(() => input.focus());
  return h("div", { class: "gfield" }, h("label", { for: fid, text: label }),
    h("div", { class: "moneybox" }, h("span", { text: "$" }), input, suffix ? h("em", { text: suffix }) : null));
}
// A slider with its value shown (and editable) beside the label.
function sliderBox(key, field, unit, on) {
  const fid = `in-${key}-${field.id}`.replace(/\W/g, "_");
  const [lo, hi] = field.range;
  const cur = () => { try { return Engine.parseNumber(raw(key, field.id), false); } catch { return NaN; } };
  const val = h("input", { type: "text", class: "sval", inputmode: "decimal", autocomplete: "off", placeholder: "—", value: raw(key, field.id), "aria-label": field.label,
    oninput: () => { setRaw(key, field.id, val.value); const v = cur(); if (Number.isFinite(v)) slider.value = Math.min(Math.max(v, lo), hi); on(); } });
  const slider = h("input", { type: "range", id: fid, min: lo, max: hi, step: field.step, value: Number.isFinite(cur()) ? Math.min(Math.max(cur(), lo), hi) : lo,
    oninput: () => { const s = Format.plain(Math.round(Number(slider.value) / field.step) * field.step, field.step < 1 ? 2 : 0); val.value = s; setRaw(key, field.id, s); on(); } });
  return h("div", { class: "gfield" },
    h("div", { class: "glab" }, h("label", { for: fid, text: field.label }), h("span", { class: "svalwrap" }, val, h("span", { text: unit }))),
    slider, h("div", { class: "gscale" }, h("span", { text: `${lo}${unit === "%" ? "%" : ""}` }), h("span", { text: `${hi}${unit === "%" ? "%" : ""}` })));
}

function growthChartSVG(sim, W) {
  const H = Math.round(Math.min(320, Math.max(220, W * 0.42)));
  const pad = { l: 66, r: 24, t: 22, b: 42 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const maxB = Math.max(...sim.bal, 1);
  const niceStep = (range, target) => { const raw = range / target, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
  const yStep = niceStep(maxB, 4), yMax = Math.ceil(maxB / yStep - 1e-9) * yStep || yStep;
  const unit = yMax >= 1e6 ? [1e6, "M"] : yMax >= 1e4 ? [1e3, "k"] : [1, ""];
  const dp = unit[0] === 1 ? 0 : Math.max(0, -Math.floor(Math.log10(yStep / unit[0]) + 1e-9));
  const yLabel = (v) => (v === 0 ? "$0" : "$" + (v / unit[0]).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) + unit[1]);
  const inYears = sim.months > 36, per = inYears ? 12 : 1, span = sim.months / per;
  const fit = Math.max(3, Math.floor(iw / 80));
  const step = (inYears ? [1, 2, 5, 10, 25, 50] : [1, 2, 3, 6, 12]).find((s) => span / s <= fit) || (inYears ? 50 : 12);
  const x = (k) => pad.l + (k / sim.months) * iw, y = (b) => pad.t + ih - (b / yMax) * ih;
  const out = [];
  for (let v = 0; v <= yMax + 1e-6; v += yStep) out.push(`<line x1="${pad.l}" x2="${pad.l + iw}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? "gaxis" : "ggrid"}"/><text x="${pad.l - 10}" y="${y(v) + 4}" text-anchor="end" class="gtick">${yLabel(v)}</text>`);
  for (let t = 0; t <= span + 1e-9; t += step) out.push(`<line x1="${x(t * per)}" x2="${x(t * per)}" y1="${pad.t + ih}" y2="${pad.t + ih + 5}" class="gaxis"/><text x="${x(t * per)}" y="${pad.t + ih + 20}" text-anchor="middle" class="gtick">${t}</text>`);
  out.push(`<text x="${pad.l + iw}" y="${H - 2}" text-anchor="end" class="gtick small">${inYears ? "Years" : "Months"}</text>`);
  const line = sim.bal.map((b, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(b).toFixed(1)}`).join(" ");
  out.push(`<path d="${line} L${x(sim.months).toFixed(1)} ${y(0)} L${x(0)} ${y(0)} Z" class="garea"/><path d="${line}" class="gline"/><circle cx="${x(0)}" cy="${y(sim.bal[0])}" r="3.5" class="gdot"/>`);
  if (sim.runOut !== null) {
    const k = sim.runOut, left = x(k) > pad.l + iw * 0.68;
    const lbl = inYears ? `Reaches $0 in year ${Math.ceil(k / 12)}` : `Reaches $0 in month ${k}`;
    out.push(`<line x1="${x(k)}" x2="${x(k)}" y1="${y(0)}" y2="${pad.t + 4}" class="gmark"/><circle cx="${x(k)}" cy="${y(0)}" r="5" class="gzero"/><text x="${x(k) + (left ? -8 : 8)}" y="${pad.t + 14}" text-anchor="${left ? "end" : "start"}" class="glabel">${lbl}</text>`);
  } else {
    const k = sim.months, b = sim.bal[k];
    out.push(`<circle cx="${x(k)}" cy="${y(b)}" r="5" class="gdot"/><text x="${x(k) - 10}" y="${Math.max(y(b) - 12, 14)}" text-anchor="end" class="glabel">${usd0(b)}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Balance by ${inYears ? "year" : "month"}, from ${usd0(sim.bal[0])} to ${usd0(sim.bal[sim.months])}">${out.join("")}</svg>`;
}
function growthChart(sim) {
  const box = h("div", { class: "gchart" });
  let w = 0;
  const draw = () => { const nw = Math.max(280, Math.round(box.clientWidth)); if (nw !== w) { w = nw; box.innerHTML = growthChartSVG(sim, w); } };
  requestAnimationFrame(draw);
  new ResizeObserver(draw).observe(box);
  return box;
}

function growthTool(tool) {
  growthWdOpen = growthWdOpen || String(raw(GKEY, "wd")).trim() !== "";
  const run = () => clientRun(GKEY, "growth_schedule", Spec.growth);
  const f = Object.fromEntries(Spec.growth.map((x) => [x.id, x]));
  return toolPage(tool, (on, refill) => [
    h("div", { class: "ginputs" },
      moneyBox(GKEY, "p", "Starting amount", null, on),
      moneyBox(GKEY, "m", "Added each month", "/ mo", on),
      sliderBox(GKEY, f.r, "%", on),
      sliderBox(GKEY, f.y, "yrs", on),
      growthWdOpen
        ? [moneyBox(GKEY, "wd", "Taken out each month", "/ mo", on, !String(raw(GKEY, "wd")).trim()),
          h("button", { class: "link quiet", text: "Remove withdrawal", onclick: () => { growthWdOpen = false; setRaw(GKEY, "wd", ""); refill(); on(); } })]
        : h("button", { class: "link addwd", text: "+ Add a withdrawal", onclick: () => { growthWdOpen = true; refill(); } })),
    more(GKEY, Spec.growth.slice(5), "Inflation shows what the ending balance would buy in today's dollars.", inputs(GKEY, "growth_schedule", Spec.growth.slice(5), on)),
  ], () => {
    const c = run();
    const eyebrow = h("div", { class: "eyebrow", text: tool.title });
    if (!c?.ok || !c.ev.table) {
      return [eyebrow, h("p", { class: "answer-head", text: "Type in your numbers to see the answer." }), needsInput(c),
        h("button", { class: "btn no-print", text: "Use an example: $1,000, $100 a month, 0%, two years", onclick: () => {
          Object.entries({ p: "1,000", m: "100", r: "0", y: "2" }).forEach(([k, v]) => setRaw(GKEY, k, v));
          route();
        } })];
    }
    const num = (id, pct) => { try { return Engine.parseNumber(c.inputs[id], pct); } catch { return 0; } };
    const p = num("p"), m = num("m"), r = num("r", true), years = Math.trunc(num("y")), wd = num("wd");
    const sim = growthMonths(p, m, r, years, wd);
    // The chart must agree with the audited calculator; if it ever doesn't, say so rather than show it.
    const agrees = Math.abs(sim.end - c.v(0)) < 0.01 && Math.abs(sim.withdrawn - c.v(4)) < 0.01;
    const span = yearsWord(years), planned = wd * years * 12, hasInfl = String(raw(GKEY, "infl")).trim() !== "";
    let head, sub;
    if (wd > 0 && sim.runOut !== null) {
      head = sim.months <= 36 ? `Your savings run out in month ${sim.runOut}.` : `Your savings run out in year ${Math.ceil(sim.runOut / 12)}.`;
      sub = [`You could withdraw `, h("strong", { text: usd0(c.v(4)) }), ` of the `, h("strong", { text: usd0(planned) }), ` planned over ${span}.`];
    } else if (wd > 0) {
      head = `After ${span} you’d have ${usd0(c.v(0))}.`;
      sub = [`That’s after withdrawing the full `, h("strong", { text: usd0(c.v(4)) }), ` you planned.`];
    } else {
      head = `In ${span} you could have ${usd0(c.v(0))}.`;
      sub = [`Starting with `, h("strong", { text: usd0(p) }), ` and adding `, h("strong", { text: usd0(m) }), ` a month at a `, h("strong", { text: `${Format.plain(r * 100, 2)}%` }), ` annual return.`];
    }
    return [
      eyebrow,
      h("p", { class: "answer-head" }, head),
      h("p", { class: "answer-sub" }, sub),
      agrees ? growthChart(sim) : h("p", { class: "note", text: "The month-by-month chart is unavailable for these inputs." }),
      h("details", { class: "gmore" }, h("summary", { text: "Breakdown and method" }),
        h("dl", { class: "gmetrics" },
          [["Starting amount", usd0(p)], ["Total added", usd0(m * years * 12)], ["Growth", usd0(c.v(2))], ["Total withdrawn", usd0(c.v(4))],
            ...(hasInfl ? [["Ending balance in today's dollars", usd0(c.v(3))]] : [])].map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: v })))),
        h("p", { class: "note", text: "Month by month: the balance grows at one twelfth of the annual return, then the monthly deposit is added, then the withdrawal is taken out. A withdrawal never takes more than the account holds. No taxes or fees are included. The return is an assumption you choose, not a forecast." }),
        howItWorks([c])),
    ];
  }, () => [run()]);
}

function retirementTool(tool) {
  const t = () => clientRun("client.retirement", "retirement_timeline", Spec.retirement);
  return toolPage(tool, (on) => [
    group("About you", null, inputs("client.retirement", "retirement_mc", Spec.retirementYou, on)),
    group("Assumptions", "A return is an assumption, not a promise.", inputs("client.retirement", "retirement_mc", Spec.retirementAssumptions.slice(0, 3), on)),
    more("client.retirement", Spec.retirementAssumptions.slice(3), "Optional. Leave volatility empty for a single steady path, or enter it to see a range of outcomes. Enter a tax rate to include tax on withdrawals.",
      inputs("client.retirement", "retirement_mc", Spec.retirementAssumptions.slice(3), on)),
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
    const outRows = rows.filter((r) => r[3] > 0), taxed = c.v(5) > 0, O = cssVar("--orange");
    const takenText = c.v(4) > 0 ? `${Format.currency(c.v(4))} is taken out over the retirement years${taxed ? `, ${Format.currency(c.v(5))} of it for taxes` : ""}.` : "";
    return [
      headline(lasts ? `On this steady path the money lasts through age ${plan}.` : `On this steady path the money runs out around age ${Math.trunc(c.v(3))}.`,
        (lasts ? `About ${Format.currency(c.v(2))} would remain at the end of the plan. ` : `That is ${Math.trunc(plan - c.v(3))} years before the end of the plan. `) + takenText),
      stats(stat("Savings at retirement", Format.currency(c.v(0))),
        stat("First-year withdrawal", Format.currency(c.v(1)), Number.isNaN(rate) ? null : `${Format.percent(rate)} of savings at retirement${taxed ? ", including tax" : ""}`),
        stat("Total taken out in retirement", Format.currency(c.v(4)), taxed ? `Including ${Format.currency(c.v(5))} in taxes` : "Spending not covered by other income"),
        stat(lasts ? "Left at end of plan" : "Money runs out at age", lasts ? Format.currency(c.v(2)) : String(Math.trunc(c.v(3))), null, !lasts),
        mc?.ok ? stat("Simulated paths where the money lasts", Format.percent(mc.v(0)), `Out of ${mc.inputs.sims} random market paths`) : null),
      chartCard("Savings over time", mc?.ok ? "Shaded band: the middle 80% of simulated outcomes. Solid line: the steady path. Markets don't deliver the same return every year, so the band is the more realistic picture."
        : "A single steady path with the same return every year. Enter a volatility assumption to see a range.",
      chart("line", { datasets: ds }, { xType: "linear", xTitle: "Age", legend: false, size: "h280", lines: Number.isFinite(retire) ? { x: [{ value: retire, label: "Retire" }] } : {} })),
      outRows.length ? chartCard("Taken out each year", taxed
        ? "Each bar is the year's withdrawal: what is spent, plus the income tax on it at the rate entered. Amounts grow with inflation; other income such as Social Security reduces them once it starts."
        : "Each bar is the year's withdrawal: spending not covered by other income. Amounts grow with inflation and drop when other income such as Social Security starts. Taxes on withdrawals aren't included; enter a tax rate to add them.",
        chart("bar", { labels: outRows.map((r) => r[0]), datasets: [
          { label: "Spending", data: outRows.map((r) => r[3] - r[6]), backgroundColor: A, stack: "w" },
          ...(taxed ? [{ label: "Tax on withdrawals", data: outRows.map((r) => r[6]), backgroundColor: O, stack: "w" }] : []),
        ] }, { stacked: true, legend: taxed, size: "h220", maxXTicks: 12, xTitle: "Age" })) : null,
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
    group("What if…", "You choose the scenario. This shows what would happen if it occurred, not how likely it is.", inputs("client.risk", "portfolio_stress", Spec.risk.slice(3, 5), on)),
    more("client.risk", Spec.risk.slice(5), "Optional: how sensitive the bonds are to rates, inflation over the period, and any money taken out.", inputs("client.risk", "portfolio_stress", Spec.risk.slice(5), on)),
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
          { label: "Cash", data: series("cash"), backgroundColor: rgba(cssVar("--neutral"), 0.5) },
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
      h("td", { class: d < 0 ? "down" : "pos", style: d < 0 ? "" : "color:var(--accent-text)", text: (d >= 0 ? "+" : "") + Format.currency(d) }));
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
          { label: "Option A", data: A.ev.table.rows.map((r) => ({ x: r[0] + 1, y: r[5] })), borderColor: cssVar("--neutral"), backgroundColor: cssVar("--neutral"), borderWidth: 2.5 },
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
    const choice = (id, label) => {
      const f = engine.calculator("income_tax").fields.find((x) => x.id === id);
      const cur = raw("client.incometax", id) || f.example;
      return h("div", { class: "crow" }, h("div", { class: "top" }, h("label", { for: "ct-" + id, text: label }),
        h("select", { id: "ct-" + id, onchange: (e) => { setRaw("client.incometax", id, e.target.value); on(); } },
          f.options.map((o) => h("option", { value: Format.plain(o.value), selected: Format.plain(o.value) === cur, text: o.label })))));
    };
    return [seg, group("Income tax estimate", "Federal and state tax on ordinary taxable income. Local taxes, credits and other taxes aren't included.",
      inputs("client.incometax", "income_tax", Spec.incomeTax, on), choice("status", "Filing status"), choice("st", "State you file in"))];
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
          datasets: [{ label: "Ending value", data: [c.v(0), c.v(1)], backgroundColor: [rgba(cssVar("--neutral"), 0.6), cssVar("--accent")] }] }, { legend: false })),
        howItWorks([c]),
      ];
    }
    const c = tax();
    let income = null;
    try { income = Engine.parse(c?.inputs.ti ?? "", c.calc.fields[0]); } catch { /* not ready */ }
    const banner = taxBanner(() => route());
    if (!c?.ok || income === null) return [banner, needsInput(c)];
    const st = engine.tax.state(Number(c.inputs.st || 0));
    if (!st) {
      return [
        banner,
        headline(`Estimated federal income tax: ${Format.currency(c.v(0))}, which is ${Format.percent(c.v(2))} of this income.`,
          `The next dollar earned would be taxed at ${Format.percent(c.v(1))}. That higher rate applies only to income above the bracket line, not to all of it. Choose a state to add state income tax.`),
        stats(stat("Federal income tax", Format.currency(c.v(0))), stat("Average rate on this income", Format.percent(c.v(2))),
          stat("Rate on the next dollar", Format.percent(c.v(1))), stat("Room before the next bracket", Number.isNaN(c.v(3)) ? "Top bracket" : Format.currency(c.v(3)))),
        chartCard("Where the income goes", null, chart("bar", { labels: ["Income"], datasets: [
          { label: "Kept after federal income tax", data: [income - c.v(0)], backgroundColor: cssVar("--accent") },
          { label: "Federal income tax", data: [c.v(0)], backgroundColor: cssVar("--orange") },
        ] }, { stacked: true, indexAxis: "y", size: "h110" })),
        howItWorks([c]),
      ];
    }
    const noTax = st.none || (st.gains?.separate && !st.brackets);
    return [
      banner,
      headline(`Estimated income tax: ${Format.currency(c.v(7))}, which is ${Format.percent(c.v(8))} of this income.`,
        noTax ? `${st.name} has no tax on wages, so this is all federal. The next dollar would be taxed at ${Format.percent(c.v(6))}.`
          : `${Format.currency(c.v(0))} federal plus ${Format.currency(c.v(4))} ${st.name}. The next dollar would be taxed at ${Format.percent(c.v(6))}: ${Format.percent(c.v(1))} federal plus ${Format.percent(c.v(5))} state.`),
      stats(stat("Federal income tax", Format.currency(c.v(0))), stat(`${st.name} income tax`, Format.currency(c.v(4)), "Estimate; local taxes not included"),
        stat("Average rate, federal + state", Format.percent(c.v(8))), stat("Rate on the next dollar, federal + state", Format.percent(c.v(6)), `${Format.percent(c.v(1))} federal + ${Format.percent(c.v(5))} state`)),
      chartCard("Where the income goes", st.notes.length ? st.notes.join(" ") : null, chart("bar", { labels: ["Income"], datasets: [
        { label: "Kept after income tax", data: [income - c.v(7)], backgroundColor: cssVar("--accent") },
        { label: "Federal income tax", data: [c.v(0)], backgroundColor: cssVar("--orange") },
        { label: `${st.name} income tax`, data: [c.v(4)], backgroundColor: rgba(cssVar("--blue"), 0.75) },
      ] }, { stacked: true, indexAxis: "y", size: "h110" })),
      howItWorks([c]),
    ];
  }, () => [[infl, drag, tax][S.taxTab]()]);
}

// ---------------------------------------------------------------------------
// Client: market conditions (a plain reading of the published RoRo model)
// Mirrors ClientMarketView in the Mac app. Numbers come straight from data/roro.json
// via clientMarketSummary (web/client_market.js, tested by web/client-market-check.mjs).

// "Going on Medicare": what Part B and drug coverage would cost at this income, where the income tiers sit, and the
// rules that catch people out (enrollment window, working past 65, HSA, the two-year income look-back). Figures come
// from the audited medicare_premiums and medicare_penalty calculators and the CMS table for the selected year.
const MKEY = "client.medicare";
function medicareTool(tool) {
  const run = () => clientRun(MKEY, "medicare_premiums", Spec.medicare);
  const pen = () => clientRun(MKEY, "medicare_penalty", Spec.medicarePenalty);
  const seg = (id, label, opts, on, refill) => h("div", { class: "gfield" }, h("label", { text: label }),
    h("div", { class: "seg wide" }, opts.map(([v, t]) => h("button", { class: String(raw(MKEY, id)) === v ? "on" : null, text: t,
      onclick: () => { setRaw(MKEY, id, v); refill(); on(); } }))));
  return toolPage(tool, (on, refill) => [
    h("div", { class: "ginputs" },
      moneyBox(MKEY, "magi", "Income two years ago (modified AGI)", null, on),
      seg("status", "Tax return", [["1", "Single"], ["2", "Joint"]], on, refill),
      seg("n", "People on Medicare", [["1", "One"], ["2", "Two"]], on, refill),
      moneyBox(MKEY, "plan", "Drug plan premium per person", "/ mo", on)),
    more(MKEY, Spec.medicarePenalty, "Only if you signed up late. Leave empty otherwise.", inputs(MKEY, "medicare_penalty", Spec.medicarePenalty, on)),
  ], () => {
    const c = run(), p = pen();
    const eyebrow = h("div", { class: "eyebrow", text: tool.title });
    if (!c?.ok) return [eyebrow, h("p", { class: "answer-head", text: "Type in your income to see what Medicare would cost." }), needsInput(c)];
    const n = Number(raw(MKEY, "n")) === 2 ? 2 : 1;
    const penB = p?.ok ? p.v(2) : 0, penD = p?.ok ? p.v(3) : 0, pens = penB + penD;
    const monthly = c.v(4) / 12 + n * pens, yearly = monthly * 12;
    const t = engine.tax.medicare;
    const surcharge = c.v(1) - t.partB + c.v(2);
    const money = (v) => Format.currency(v);
    const status = Number(raw(MKEY, "status"));
    const bounds = t.irmaaThresholds[String(status)], tier = c.v(0);
    const head = n === 2 ? `Medicare would cost about ${money(monthly)} a month for the two of you.` : `Medicare would cost about ${money(monthly)} a month.`;
    const sub = [h("strong", { text: usd0(yearly) }), " a year for Part B and drug coverage, before supplemental coverage and out-of-pocket costs",
      surcharge > 0 ? [", including an income-related surcharge of ", h("strong", { text: money(surcharge) }), " a month per person."] : ". No income-related surcharge at this income.",
      pens > 0 ? [" That includes late-enrollment penalties of ", h("strong", { text: money(pens) }), " a month per person."] : null];
    const k$ = (v) => "$" + Math.round(v).toLocaleString("en-US");
    const ranges = [`Up to ${k$(bounds[0])}`, ...[0, 1, 2, 3].map((i) => `${k$(bounds[i])} – ${k$(bounds[i + 1])}`), `${k$(bounds[4])} or more`];
    const room = c.v(6);
    const spend = String(raw("client.retirement", "spend")).trim();
    const addBtn = () => {
      if (!spend) return h("p", { class: "note", text: `In “Am I on track for retirement?”, include about ${usd0(yearly)} a year for Medicare in retirement spending.` });
      if (raw(MKEY, "_added") === spend) return h("p", { class: "note", text: "Added to retirement spending." });
      return h("div", { style: "display:flex;flex-direction:column;gap:6px;align-items:flex-start" },
        h("p", { class: "note", text: "This uses today's income tier. Income often drops in retirement, which can mean a lower tier." }),
        h("button", { class: "btn no-print", text: `Add ${usd0(yearly)} a year to retirement spending`, onclick: () => {
        let cur = 0;
        try { cur = Engine.parseNumber(spend, false); } catch { /* leave spending as typed */ }
        const next = Format.plain(Math.round(cur + yearly), 0);
        setRaw("client.retirement", "spend", next); setRaw(MKEY, "_added", next);
        toast(`Retirement spending is now ${usd0(cur + yearly)} a year.`); route();
      } }));
    };
    return [
      eyebrow,
      h("p", { class: "answer-head", text: head }),
      h("p", { class: "answer-sub" }, sub),
      h("section", { class: "plain-section" },
        h("h2", { class: "eyebrow", text: `${engine.tax.taxYear} income tiers · ${status === 2 ? "joint return" : "single return"}` }),
        h("table", { class: "tiers" },
          h("thead", {}, h("tr", {}, h("th", { text: "Income two years earlier" }), h("th", { class: "r", text: "Per person, monthly" }))),
          h("tbody", {}, ranges.map((r, i) => h("tr", { class: i === tier ? "on" : null },
            h("td", {}, r, i === tier ? h("span", { class: "you", text: "You" }) : null),
            h("td", { class: "r tnum", text: money(t.partB + t.partBAdjust[i] + t.partDAdjust[i]) }))))),
        h("p", { class: "note", text: (tier >= 5 ? "This is the top tier. " : `You're ${usd0(room)} below the next tier. One dollar over a line raises the premium for the whole year. `)
          + "Per person: Part B plus the drug-coverage surcharge, before the drug plan's own premium." })),
      h("dl", { class: "plain-rows facts" },
        [["When to sign up", "Your first chance is a seven-month window: the three months before the month you turn 65, that month, and the three months after."],
          ["Still working at 65", "If you or your spouse are still working and covered by that employer's group plan (20 or more employees), you can usually wait on Part B without a penalty, then sign up within 8 months after the job or the coverage ends."],
          ["Health savings account", "Contributions have to stop once Medicare starts. If you sign up after 65, Part A is backdated up to six months, so stop contributing six months before you apply."],
          ["Why income from two years ago", "Social Security sets the surcharge from your tax return two years before. After a life-changing event, such as retiring, you can ask it to use a more recent year with form SSA-44."]]
          .map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: v })))),
      addBtn(),
      h("details", { class: "gmore" }, h("summary", { text: "Breakdown and method" }),
        h("dl", { class: "gmetrics" }, [["Part B, per person", money(c.v(1))], ["Drug-coverage surcharge, per person", money(c.v(2))],
          ["Drug plan, per person", money(c.v(3) - c.v(1) - c.v(2))], ["Penalties, per person", money(pens)]].map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: v })))),
        h("p", { class: "note", text: `Uses CMS's ${engine.tax.taxYear} Part B premium ($${t.partB.toFixed(2)}) and income tiers. Part A is assumed premium-free, as it is for about 99% of people. Not included: Medicare Advantage or Medigap premiums, deductibles and other out-of-pocket costs. Sources: the CMS premium fact sheet, Medicare.gov and the Social Security Administration.` }),
        howItWorks(p?.ok && pens > 0 ? [c, p] : [c])),
    ];
  }, () => { const c = run(); return c?.ok ? [c, pen()] : [c]; });   // the penalty calc is complete even when empty
}

function marketTool(tool) {
  const m = data.roro;
  const sum = clientMarketSummary(m);
  let content;
  if (m === undefined) {
    content = [h("p", { class: "secondary", text: "Loading the latest published market data…" })];
  } else if (!sum) {
    content = [h("p", { class: "plain-lead", text: "Market data isn't available right now." }),
      h("p", { class: "plain-sub", text: "It is published every weekday after the US market close. Try again later." }),
      h("div", {}, tbtn("refresh", "Try again", async () => { await loadRoRo(true); route(); }))];
  } else {
    const st = roroStatus(m);
    const A = cssVar("--accent");
    const ov = sum.overall;
    content = [
      h("div", { class: "eyebrow" }, `Market conditions · ${sum.asof ?? ""}`, h("span", { class: "statuspill " + st.cls, text: st.label })),
      h("p", { class: "plain-lead" }, "Market conditions look ", h("span", { class: "c-" + marketTone(ov.value), text: ov.word.toLowerCase() }), " right now."),
      h("p", { class: "plain-sub" }, `Our gauge combines ${sum.indicators} public economic and market indicators. It reads `, h("strong", { text: signed(ov.value) }),
        " on a scale from −100 (stressed) to +100 (supportive). It describes conditions today. It does not predict returns."),
      h("dl", { class: "plain-rows" }, sum.horizons.map((z) => h("div", {},
        h("dt", {}, z.name, h("small", { text: z.desc })),
        h("dd", {}, h("span", { class: "c-" + marketTone(z.value), text: z.word }), h("span", { class: "secondary tnum", text: signed(z.value) }))))),
      h("section", { class: "plain-section" }, h("h2", { class: "eyebrow", text: "What is behind it" }),
        h("div", { class: "cbuckets" }, sum.buckets.map((b) => h("div", { class: "cbrow" },
          h("span", { class: "lbl", text: b.label }), scoreBar(b.value),
          h("span", { class: "wd c-" + marketTone(b.value), text: b.word })))),
        h("p", { class: "note", text: "Each bar summarizes a group of indicators. Left of center is more stressed, right is more supportive." })),
      h("section", { class: "plain-section" }, h("h2", { class: "eyebrow", text: "The last two years" }),
        chart("line", { labels: sum.history.map((p) => p.x), datasets: [
          { label: "Medium-term reading", data: sum.history.map((p) => p.y), borderColor: A, backgroundColor: A, borderWidth: 2 }] },
        { money: false, yMin: -100, yMax: 100, zero: false, maxXTicks: 8, legend: false, label: "Medium-term market reading over the last two years",
          tooltip: (c) => `Reading: ${signed(c.parsed.y, 1)}`, lines: { y: [{ value: 0, color: rgba(cssVar("--neutral"), 0.6) }] } }),
        h("p", { class: "note", text: "Conditions change; today's reading says nothing certain about tomorrow's." })),
      h("div", { class: "no-print", style: "display:flex;gap:16px;flex-wrap:wrap;align-items:center" },
        h("a", { class: "btn", href: "#/client/risk", text: "Explore a what-if with the risk tool" }),
        h("a", { class: "callout", href: "#/advisor", text: "Back to the Advisor Market Brief" }),
        h("button", { class: "link", text: "Reload", onclick: async () => { await loadRoRo(true); route(); toast("Reloaded the latest published market data."); } })),
      h("p", { class: "note", text: "Sources: Federal Reserve Economic Data (FRED) and delayed market prices from Yahoo Finance's unofficial feed, scored once each weekday after the US close by the same engine as the Mac app. Readings come from a hand-calibrated model that has not been validated as a predictor of returns. This is general market information, not investment advice or a recommendation." }),
    ];
  }
  clientCalcs = () => [];
  return {
    title: tool.title, subtitle: "Client Mode",
    actions: () => [
      tbtn("doc", "PDF report", () => { sum ? window.print() : toast("Market data hasn't loaded yet."); }, { help: "Print, or choose Save as PDF in the print dialog" }),
      tbtn("eraser", "Clear", clearSession, { help: "Erase everything typed this session" }),
    ],
    body: h("div", { class: "page wide plain-page" },
      printHead("Client illustration", tool.title), crumb(),
      ...content, footnote()),
  };
}

// ---------------------------------------------------------------------------
// Router

const ADVISOR_PAGES = { roro: roroPage, markets: marketsPage, stock: stockPage, calculators: calculatorsPage, calculator: padPage, scenarios: scenariosPage, history: historyPage };

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [mode, sub] = parts;
  if (mode === "calc") { location.replace("#/advisor/calculator"); return; }
  if (mode === "advisor") {
    if (sub === "roro" && data.roro === undefined) loadRoRo().then(route);
    if (sub === "markets" && data.markets === undefined) loadMarkets().then(route);
    if (sub === "stock" && data.roro === undefined) loadRoRo().then(route);
    if (sub === "stock" && data.tickers === undefined) loadTickers();
    if (!sub) return show(advisorHome(), { mode, selected: "home" });
    if (sub === "home") { location.replace("#/advisor"); return; }
    if (ADVISOR_PAGES[sub]) return show(ADVISOR_PAGES[sub](), { mode, selected: sub });
    const calc = engine.calculator(sub);
    return calc ? show(calcPage(calc), { mode, selected: calc.id })
      : show({ title: "Not found", body: unavailable("info", "Not found", "That calculator isn't in this catalog.") }, { mode });
  }
  if (mode === "client") {
    const tool = TOOLS.find((t) => t.id === sub);
    if (!tool) return show(clientHome(), { mode });
    if (tool.id === "market" && data.roro === undefined) loadRoRo().then(route);
    const make = { growth: growthTool, retirement: retirementTool, risk: riskTool, decisions: decisionsTool, taxes: taxesTool, market: marketTool, medicare: medicareTool }[tool.id];
    return show(make(tool), { mode });
  }
  show(startPage());
}

async function boot() {
  try {
    const [catalog, taxJson, states] = await Promise.all([loadJSON("data/catalog.json"), loadJSON("data/taxdata.json"),
      loadJSON("data/statetax.json").catch(() => null)]);
    const taxData = new TaxData(withStates(taxJson, states));
    engine = new Engine(catalog, taxData, taxData.years.includes(Prefs.taxYear) ? Prefs.taxYear : undefined);
  } catch (e) {
    fill(app, unavailable("warn", "Wealth Desk couldn't start", `The calculator data didn't load (${e.message}). Check the connection and reload.`));
    return;
  }
  window.addEventListener("hashchange", route);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", route);
  route();
}
boot();
