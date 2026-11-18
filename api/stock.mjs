// Wealth Desk stock lookup (Vercel function). Browsers can't read Yahoo's or the SEC's data
// directly, so the web version asks here. It takes a ticker symbol and/or an SEC company number,
// fetches the public data, trims it to what the screen uses, and sends it back.
// Nothing is stored or logged; the only input is the symbol.
//   /api/stock?t=AAPL&cik=320193   prices (Yahoo, with SPY as the benchmark) + SEC facts and filings
//   /api/stock?cik=320193&only=sec SEC facts and filings only (the Mac app fetches prices itself)
//   /api/stock?list=tickers        the SEC's ticker list as { TICKER: [cik, name] }
// The SEC asks automated tools to name a contact: set SEC_CONTACT in the Vercel project settings.
import { trimChart, trimFacts, trimSubs } from "../WealthDesk/web/stock.js";

const ORIGINS = new Set(["https://agbyron31.github.io", "https://da-scene.vercel.app"]);
const YAHOO_UA = "Mozilla/5.0 (Macintosh) WealthDesk";
const secUA = () => `WealthDesk/2.0 ${process.env.SEC_CONTACT || "(independent research tool)"}`;
const memo = new Map(); // short-lived, in this instance's memory only: { key: [expires, value] }

async function cached(key, ms, make) {
  const hit = memo.get(key);
  if (hit && hit[0] > Date.now()) return hit[1];
  const v = await make();
  memo.set(key, [Date.now() + ms, v]);
  return v;
}
async function getJSON(url, ua) {
  const r = await fetch(url, { headers: { "User-Agent": ua, Accept: "application/json" } });
  if (!r.ok) { const e = new Error(`${new URL(url).hostname} answered ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
function chartURL(sym, intraday) {
  const s = encodeURIComponent(sym);
  if (intraday) return `https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=1d&interval=5m`;
  const now = Math.floor(Date.now() / 1000), p1 = now - Math.floor((10 * 365.25 + 20) * 86400);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${s}?period1=${p1}&period2=${now}&interval=1d&events=div%2Csplit&includeAdjustedClose=true`;
}
const cik10 = (c) => String(c).padStart(10, "0");

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && (ORIGINS.has(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin))) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const send = (code, body, cache) => {
    res.statusCode = code;
    res.setHeader("Cache-Control", cache || "no-store");
    res.end(JSON.stringify(body));
  };
  if (req.method !== "GET") return send(405, { error: "GET only." });
  const q = new URL(req.url, "http://x").searchParams;
  try {
    if (q.get("list") === "tickers") {
      if (!process.env.SEC_CONTACT) return send(503, { error: "The SEC ticker list needs a contact set up on the server (SEC_CONTACT)." });
      const map = await cached("tickers", 6 * 3600e3, async () => {
        const d = await getJSON("https://www.sec.gov/files/company_tickers.json", secUA()), m = {};
        for (const v of Object.values(d)) { const t = String(v.ticker).toUpperCase(); if (!(t in m)) m[t] = [v.cik_str, v.title]; }
        return m;
      });
      return send(200, map, "public, s-maxage=86400, max-age=3600");
    }
    const t = (q.get("t") || "").toUpperCase(), cik = q.get("cik") || "", only = q.get("only");
    if (t && !/^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/.test(t)) return send(400, { error: "That isn't a valid ticker symbol." });
    if (cik && !/^\d{1,10}$/.test(cik)) return send(400, { error: "That isn't a valid SEC company number." });
    if (!t && !cik) return send(400, { error: "Give a ticker symbol." });
    const out = {};
    const jobs = [];
    if (t && only !== "sec") {
      jobs.push(getJSON(chartURL(t), YAHOO_UA).then((c) => { out.daily = trimChart(c); }));
      jobs.push(getJSON(chartURL(t, true), YAHOO_UA).then((c) => { out.intraday = trimChart(c); }).catch(() => { out.intraday = null; }));
      jobs.push(cached("bench", 600e3, async () => trimChart(await getJSON(chartURL("SPY"), YAHOO_UA))).then((b) => { out.bench = b; }));
    }
    if (cik) {
      jobs.push(getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10(cik)}.json`, secUA())
        .then((f) => { out.facts = trimFacts(f); }).catch((e) => { out.facts = null; out.factsError = e.status === 404 ? "The SEC has no financial statements in XBRL for this company." : e.message; }));
      jobs.push(getJSON(`https://data.sec.gov/submissions/CIK${cik10(cik)}.json`, secUA())
        .then((s) => { out.subs = trimSubs(s); }).catch(() => { out.subs = null; }));
    }
    await Promise.all(jobs);
    return send(200, out, "public, s-maxage=600, max-age=60");
  } catch (e) {
    return send(e.status === 404 ? 404 : 502, { error: e.status === 404 ? "No data for that symbol." : `The data source didn't answer (${e.message}). Try again shortly.` });
  }
}
