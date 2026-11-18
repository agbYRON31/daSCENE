// Stock research: the numbers behind the one-ticker screen.
//
// Same rules as tools/stock_reference.py (the reference) and Sources/WealthCore/Stock.swift;
// web/stock-check.mjs compares all three on saved public data. Read the rules there.
//
// Input: { daily, intraday, bench, facts, subs } where daily/intraday/bench are trimmed Yahoo
// chart data ({ meta, timestamp, close, adjclose, dividends: [[ts, amt]], splits: [[ts, num, den]] })
// and facts/subs are the SEC's XBRL company facts and filing list (trimmed or full).

export const CONCEPTS = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
  grossProfit: ["GrossProfit"],
  opIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"],
  shares: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  ocf: ["NetCashProvidedByUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  daTotal: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"],
  daDepreciation: ["Depreciation"],
  daAmortization: ["AmortizationOfIntangibleAssets"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  debtTotal: ["LongTermDebt", "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"],
  debtNoncurrent: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"],
  debtCurrent: ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
  equity: ["StockholdersEquity"],
  dps: ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
};
const UNIT = { eps: "USD/shares", dps: "USD/shares", shares: "shares" };
const PER_SHARE = new Set(["eps", "dps"]);
const FLOWS = ["revenue", "grossProfit", "opIncome", "netIncome", "eps", "shares", "ocf", "capex", "dps"];
const COMPOSITE = { da: ["daTotal", "daDepreciation", "daAmortization"], debt: ["debtTotal", "debtNoncurrent", "debtCurrent"] };
const STALE_DAYS = 200;
const FILING_FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "20-F", "40-F", "6-K", "DEF 14A", "S-1"]);
export const PERIODS = [["1M", 1, 0], ["3M", 3, 0], ["6M", 6, 0], ["YTD", 0, 0], ["1Y", 0, 1], ["3Y", 0, 3], ["5Y", 0, 5], ["10Y", 0, 10]];

const DAY = 86400000;
export const dnum = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d) / DAY; };
export const dstr = (n) => (n === null || n === undefined ? null : new Date(n * DAY).toISOString().slice(0, 10));
const tsDay = (ts, off) => Math.floor((ts + off) / 86400);
const ymd = (n) => { const d = new Date(n * DAY); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
function shift(day, months, years) {
  const [y0, m0, d0] = ymd(day);
  const m = y0 * 12 + (m0 - 1) - months - 12 * years;
  const y = Math.floor(m / 12), mo = m - y * 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return Date.UTC(y, mo, Math.min(d0, last)) / DAY;
}

function series(ch) {
  const off = ch.meta.gmtoffset || 0, adj = ch.adjclose || ch.close, out = [];
  ch.timestamp.forEach((t, i) => {
    const c = ch.close[i], a = adj[i];
    if (c === null || c === undefined || a === null || a === undefined) return;
    const day = tsDay(t, off);
    if (out.length && out[out.length - 1][0] === day) out[out.length - 1] = [day, c, a];
    else out.push([day, c, a]);
  });
  return out;
}
function atOrBefore(s, day) {
  let lo = 0, hi = s.length - 1, k = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[mid][0] <= day) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  return k;
}
function periodReturns(s) {
  const out = {};
  if (!s.length) { PERIODS.forEach(([k]) => { out[k] = null; }); return out; }
  const last = s[s.length - 1];
  for (const [key, mo, yr] of PERIODS) {
    const target = key === "YTD" ? Date.UTC(ymd(last[0])[0] - 1, 11, 31) / DAY : shift(last[0], mo, yr);
    const k = atOrBefore(s, target);
    if (k === null) { out[key] = null; continue; }
    let r = last[2] / s[k][2] - 1;
    if (yr >= 3) r = Math.pow(1 + r, 365.25 / (last[0] - s[k][0])) - 1;
    out[key] = r;
  }
  return out;
}
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
function volatility(s) {
  if (s.length < 2) return null;
  const start = s[s.length - 1][0] - 365, r = [];
  for (let i = 1; i < s.length; i++) if (s[i][0] > start) r.push(Math.log(s[i][2] / s[i - 1][2]));
  if (r.length < 20) return null;
  const m = mean(r);
  return Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252);
}
function monthEnds(s) {
  const out = new Map();
  if (!s.length) return out;
  const [cy, cm] = ymd(s[s.length - 1][0]), cur = cy * 12 + cm - 1;
  for (const [day, , a] of s) { const [y, m] = ymd(day), k = y * 12 + m - 1; if (k < cur) out.set(k, a); }
  return out;
}
function beta(s, b) {
  const ms = monthEnds(s), mb = monthEnds(b);
  const keys = [...ms.keys()].filter((k) => mb.has(k) && ms.has(k - 1) && mb.has(k - 1)).sort((x, y) => x - y).slice(-60);
  if (keys.length < 24) return [null, keys.length];
  const x = keys.map((k) => ms.get(k) / ms.get(k - 1) - 1), y = keys.map((k) => mb.get(k) / mb.get(k - 1) - 1);
  const mx = mean(x), my = mean(y);
  const v = y.reduce((a, q) => a + (q - my) ** 2, 0);
  let c = 0;
  for (let i = 0; i < x.length; i++) c += (x[i] - mx) * (y[i] - my);
  return [c / v, keys.length];
}
function drawdown(s) {
  if (!s.length) return {};
  let peak = s[0][2], peakDay = s[0][0], best = [0, null, null];
  for (const [day, , a] of s) {
    if (a > peak) { peak = a; peakDay = day; }
    const dd = 1 - a / peak;
    if (dd > best[0]) best = [dd, peakDay, day];
  }
  let rec = null;
  if (best[1] !== null) {
    const pk = s.find((x) => x[0] === best[1])[2];
    const r = s.find((x) => x[0] > best[2] && x[2] >= pk);
    rec = r ? r[0] : null;
  }
  const runPeak = Math.max(...s.map((x) => x[2]));
  return { maxDD: best[0], peakDay: dstr(best[1]), troughDay: dstr(best[2]), recoveryDay: dstr(rec), currentDD: 1 - s[s.length - 1][2] / runPeak };
}

class Facts {
  constructor(facts, splits) {
    this.g = facts?.facts?.["us-gaap"] || {};
    this.dei = facts?.facts?.dei || {};
    this.splits = splits;
    this.cache = new Map();
  }
  factor(filed) { let f = 1; for (const [day, n, d] of this.splits) if (day > filed) f *= n / d; return f; }
  entries(concept, unit) {
    const key = concept + "|" + unit;
    if (!this.cache.has(key)) {
      this.cache.set(key, (this.g[concept]?.units?.[unit] || []).map((e, i) => ({
        start: e.start ? dnum(e.start) : null, end: dnum(e.end), val: e.val, filed: dnum(e.filed), i })));
    }
    return this.cache.get(key);
  }
  adjust(key, val, filed) {
    if (PER_SHARE.has(key)) return val / this.factor(filed);
    if (key === "shares") return val * this.factor(filed);
    return val;
  }
  best(cands, target) {
    let b = null;
    for (const e of cands) {
      if (!b) { b = e; continue; }
      const k1 = [e.filed, -Math.abs(e.end - target), e.i], k2 = [b.filed, -Math.abs(b.end - target), b.i];
      if (k1[0] > k2[0] || (k1[0] === k2[0] && (k1[1] > k2[1] || (k1[1] === k2[1] && k1[2] > k2[2])))) b = e;
    }
    return b;
  }
  valueAt(key, end, flow) {
    const unit = UNIT[key] || "USD";
    for (const c of CONCEPTS[key]) {
      const cands = this.entries(c, unit).filter((e) => Math.abs(e.end - end) <= 7 &&
        (flow ? (e.start !== null && e.end - e.start >= 340 && e.end - e.start <= 390) : e.start === null));
      if (cands.length) { const e = this.best(cands, end); return this.adjust(key, e.val, e.filed); }
    }
    return null;
  }
  compositeAt(key, end, flow) {
    const [total, p1, p2] = COMPOSITE[key];
    const t = this.valueAt(total, end, flow);
    if (t !== null) return t;
    const a = this.valueAt(p1, end, flow), c = this.valueAt(p2, end, flow);
    if (a === null && c === null) return null;
    return (a ?? 0) + (c ?? 0);
  }
  fiscalEnds() {
    const ends = new Set();
    for (const key of ["revenue", "netIncome"]) for (const c of CONCEPTS[key]) for (const e of this.entries(c, "USD")) {
      if (e.start !== null && e.end - e.start >= 340 && e.end - e.start <= 390) ends.add(e.end);
    }
    const kept = [];
    for (const d of [...ends].sort((a, b) => b - a)) if (kept.every((k) => Math.abs(d - k) > 7)) kept.push(d);
    return kept.slice(0, 10).sort((a, b) => a - b);
  }
  ttm(key, fyEnd) {
    const unit = UNIT[key] || "USD";
    for (const c of CONCEPTS[key]) {
      const es = this.entries(c, unit);
      const fy = es.filter((e) => e.start !== null && Math.abs(e.end - fyEnd) <= 7 && e.end - e.start >= 340 && e.end - e.start <= 390);
      if (!fy.length) continue;
      const f = this.best(fy, fyEnd), fv = this.adjust(key, f.val, f.filed);
      const ytd = es.filter((e) => e.start !== null && e.start - fyEnd > 0 && e.start - fyEnd <= 10 && e.end - e.start < 340);
      if (ytd.length) {
        const qEnd = Math.max(...ytd.map((e) => e.end));
        const cur = this.best(ytd.filter((e) => e.end === qEnd), qEnd), dur = cur.end - cur.start;
        const pr = es.filter((e) => e.start !== null && Math.abs(e.end - (qEnd - 365)) <= 10 && Math.abs((e.end - e.start) - dur) <= 10);
        if (pr.length) {
          const p = this.best(pr, qEnd - 365);
          return [fv + this.adjust(key, cur.val, cur.filed) - this.adjust(key, p.val, p.filed), qEnd];
        }
      }
      return [fv, f.end];
    }
    return [null, null];
  }
  compositeTTM(key, fyEnd) {
    const [total, p1, p2] = COMPOSITE[key];
    const t = this.ttm(total, fyEnd);
    if (t[0] !== null) return t;
    const a = this.ttm(p1, fyEnd), c = this.ttm(p2, fyEnd);
    if (a[0] === null && c[0] === null) return [null, null];
    return [(a[0] ?? 0) + (c[0] ?? 0), a[0] !== null ? a[1] : c[1]];
  }
  latestInstant(keys) {
    let m = null;
    for (const k of keys) for (const c of CONCEPTS[k]) for (const e of this.entries(c, UNIT[k] || "USD")) {
      if (e.start === null && (m === null || e.end > m)) m = e.end;
    }
    return m;
  }
  sharesOut() {
    const es = this.dei.EntityCommonStockSharesOutstanding?.units?.shares || [];
    if (!es.length) return [null, null];
    let b = null, bk = null;
    es.forEach((e, i) => {
      const k = [dnum(e.end), dnum(e.filed), i];
      if (!bk || k[0] > bk[0] || (k[0] === bk[0] && (k[1] > bk[1] || (k[1] === bk[1] && k[2] > bk[2])))) { b = e; bk = k; }
    });
    return [b.val * this.factor(dnum(b.filed)), dnum(b.end)];
  }
}

const div = (a, b) => (a === null || a === undefined || b === null || b === undefined || b === 0 ? null : a / b);
const posDiv = (a, b) => (a === null || a === undefined || b === null || b === undefined || b <= 0 ? null : a / b);
function median(v) {
  const x = v.filter((q) => q !== null && q !== undefined).sort((a, b) => a - b);
  if (x.length < 3) return null;
  const n = x.length;
  return n % 2 ? x[(n - 1) / 2] : (x[n / 2 - 1] + x[n / 2]) / 2;
}

export function analyze(fx) {
  const daily = fx.daily, bench = fx.bench, intra = fx.intraday || { meta: {} }, meta = daily.meta;
  const s = series(daily), b = series(bench), off = meta.gmtoffset || 0;
  if (!s.length) throw new Error("No price history for this symbol.");
  const price = intra.meta.regularMarketPrice ?? meta.regularMarketPrice;
  let prev = intra.meta.chartPreviousClose ?? null;
  if (prev === null) prev = s.length > 1 ? s[s.length - 2][1] : null;
  const rs = periodReturns(s), rb = periodReturns(b);
  const [bt, months] = beta(s, b);
  const divs = (daily.dividends || []).map(([t, a]) => [tsDay(t, off), a]);
  const last = s[s.length - 1][0];
  let ttmDiv = 0;
  for (const [d, a] of divs) if (d > last - 365) ttmDiv += a;
  const yr = ymd(last)[0], byYear = new Map();
  for (const [d, a] of divs) { const y = ymd(d)[0]; byYear.set(y, (byYear.get(y) || 0) + a); }
  const a1 = byYear.get(yr - 1) || 0, a6 = byYear.get(yr - 6) || 0;
  const growth5 = a1 > 0 && a6 > 0 ? Math.pow(a1 / a6, 0.2) - 1 : null;

  const splits = (daily.splits || []).map(([t, n, d]) => [tsDay(t, off), n, d]);
  const F = new Facts(fx.facts, splits);
  const ends = F.fiscalEnds();
  const rows = ends.map((e) => {
    const r = { end: dstr(e) };
    for (const k of FLOWS) r[k] = F.valueAt(k, e, true);
    r.cash = F.valueAt("cash", e, false);
    r.equity = F.valueAt("equity", e, false);
    r.debt = F.compositeAt("debt", e, false);
    r.da = F.compositeAt("da", e, true);
    r.fcf = r.ocf === null || r.capex === null ? null : r.ocf - r.capex;
    for (const [m, k] of [["grossMargin", "grossProfit"], ["opMargin", "opIncome"], ["netMargin", "netIncome"], ["fcfMargin", "fcf"]]) r[m] = posDiv(r[k], r.revenue);
    const k = atOrBefore(s, e);
    r.price = k !== null && e >= s[0][0] ? s[k][1] : null;
    const mcap = r.price === null || r.shares === null ? null : r.price * r.shares;
    r.pe = posDiv(r.price, r.eps);
    r.ps = posDiv(mcap, r.revenue);
    r.fcfYield = div(r.fcf, mcap);
    const ebitda = r.opIncome === null || r.da === null ? null : r.opIncome + r.da;
    const ev = mcap === null ? null : mcap + (r.debt ?? 0) - (r.cash ?? 0);
    r.evEbitda = posDiv(ev, ebitda);
    return r;
  });
  rows.forEach((r, i) => {
    const p = i ? rows[i - 1] : null;
    r.revGrowth = !p || p.revenue === null || r.revenue === null || p.revenue <= 0 ? null : r.revenue / p.revenue - 1;
    r.epsGrowth = !p || p.eps === null || r.eps === null || p.eps <= 0 ? null : r.eps / p.eps - 1;
  });

  const ttm = {};
  if (ends.length) {
    for (const k of ["revenue", "grossProfit", "opIncome", "netIncome", "eps", "ocf", "capex", "da"]) {
      const [v, through] = COMPOSITE[k] ? F.compositeTTM(k, ends[ends.length - 1]) : F.ttm(k, ends[ends.length - 1]);
      ttm[k] = v;
      if (k === "revenue" || k === "eps") ttm[k + "Through"] = dstr(through);
    }
  }
  ttm.fcf = ttm.ocf === null || ttm.ocf === undefined || ttm.capex === null || ttm.capex === undefined ? null : ttm.ocf - ttm.capex;
  ttm.ebitda = ttm.opIncome === null || ttm.opIncome === undefined || ttm.da === null || ttm.da === undefined ? null : ttm.opIncome + ttm.da;

  const bal = {};
  let ref = null;
  if (ends.length) ref = Math.max(ends[ends.length - 1], ...["revenueThrough", "epsThrough"].filter((k) => ttm[k]).map((k) => dnum(ttm[k])));
  for (const [key, parts] of [["cash", ["cash"]], ["equity", ["equity"]], ["debt", COMPOSITE.debt]]) {
    let e = F.latestInstant(parts);
    if (e !== null && ref !== null && e < ref - STALE_DAYS) e = null;
    bal[key] = e === null ? null : (COMPOSITE[key] ? F.compositeAt(key, e, false) : F.valueAt(key, e, false));
    bal[key + "AsOf"] = dstr(e);
  }
  let [so, soEnd] = F.sharesOut();
  if (so === null && rows.length) { so = rows[rows.length - 1].shares; soEnd = dnum(rows[rows.length - 1].end); }
  bal.sharesOut = so; bal.sharesAsOf = dstr(soEnd);

  const mcap = price === null || price === undefined || so === null ? null : price * so;
  const ev = mcap === null ? null : mcap + (bal.debt ?? 0) - (bal.cash ?? 0);
  const valuation = {
    marketCap: mcap, ev, pe: posDiv(price, ttm.eps), ps: posDiv(mcap, ttm.revenue), pb: posDiv(mcap, bal.equity),
    evEbitda: posDiv(ev, ttm.ebitda), fcfYield: div(ttm.fcf, mcap), divYield: div(ttmDiv, price),
    medians: Object.fromEntries(["pe", "ps", "evEbitda", "fcfYield"].map((k) => [k, median(rows.map((r) => r[k]))])),
  };

  const growth = { revenueCAGR: null, epsCAGR: null, years: null };
  if (rows.length >= 2) {
    const f = rows[0], l = rows[rows.length - 1], yrs = (dnum(l.end) - dnum(f.end)) / 365.25;
    growth.years = yrs;
    if (f.revenue > 0 && l.revenue > 0) growth.revenueCAGR = Math.pow(l.revenue / f.revenue, 1 / yrs) - 1;
    if (f.eps > 0 && l.eps > 0) growth.epsCAGR = Math.pow(l.eps / f.eps, 1 / yrs) - 1;
  }

  const filings = [];
  const subs = fx.subs;
  if (subs) {
    const r = subs.filings.recent, cik = parseInt(subs.cik, 10);
    for (let i = 0; i < r.form.length && filings.length < 15; i++) {
      if (!FILING_FORMS.has(r.form[i])) continue;
      filings.push({ date: r.filingDate[i], form: r.form[i], description: r.primaryDocDescription[i] || r.form[i],
        url: `https://www.sec.gov/Archives/edgar/data/${cik}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}` });
    }
  }

  return {
    symbol: meta.symbol, name: meta.longName || meta.shortName,
    quote: { price, prevClose: prev, change: prev === null ? null : price - prev, changePct: !prev ? null : price / prev - 1,
      high52: meta.fiftyTwoWeekHigh ?? null, low52: meta.fiftyTwoWeekLow ?? null, lastDay: dstr(last) },
    returns: PERIODS.map(([k]) => ({ key: k, stock: rs[k], bench: rb[k] })),
    risk: { vol1y: volatility(s), benchVol1y: volatility(b), beta5y: bt, betaMonths: months, ...drawdown(s) },
    dividends: { ttm: ttmDiv, yield: div(ttmDiv, price), growth5 },
    annual: rows, ttm, balance: bal, valuation, growth, filings,
    // For charts and the screen; not part of the cross-check.
    company: subs ? { cik: parseInt(subs.cik, 10), name: subs.name, sic: subs.sicDescription || null, exchanges: subs.exchanges || [] } : null,
    currency: meta.currency || "USD", exchange: meta.exchangeName || null, instrumentType: meta.instrumentType || null,
    chart: { days: s.map((x) => dstr(x[0])), close: s.map((x) => x[1]), adj: s.map((x) => x[2]),
      bench: b.map((x) => [dstr(x[0]), x[2]]), dividends: divs.map(([d, a]) => [dstr(d), a]) },
    intraday: intra.timestamp ? intra.timestamp.map((t, i) => [t, intra.close[i]]).filter((p) => p[1] !== null && p[1] !== undefined) : [],
  };
}

// --- Trimming raw feeds (the lookup service and the fixture tool keep only what analyze() reads) ---

export function trimChart(c) {
  const r = c?.chart?.result?.[0];
  if (!r) throw new Error(c?.chart?.error?.description || "No data for this symbol.");
  const q = r.indicators?.quote?.[0] || {};
  const keep = ["currency", "symbol", "exchangeName", "instrumentType", "regularMarketTime", "gmtoffset", "regularMarketPrice",
    "chartPreviousClose", "previousClose", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "longName", "shortName"];
  const out = { meta: Object.fromEntries(keep.filter((k) => k in r.meta).map((k) => [k, r.meta[k]])), timestamp: r.timestamp || [], close: q.close || [] };
  if (r.indicators?.adjclose) out.adjclose = r.indicators.adjclose[0].adjclose;
  const ev = r.events || {};
  out.dividends = Object.values(ev.dividends || {}).map((v) => [v.date, v.amount]).sort((a, b) => a[0] - b[0]);
  out.splits = Object.values(ev.splits || {}).map((v) => [v.date, v.numerator, v.denominator]).sort((a, b) => a[0] - b[0]);
  return out;
}
export function trimFacts(f) {
  const g = f?.facts?.["us-gaap"] || {}, dei = f?.facts?.dei || {};
  const all = Object.values(CONCEPTS).flat();
  return { cik: f?.cik, entityName: f?.entityName, facts: {
    "us-gaap": Object.fromEntries(all.filter((k) => g[k]).map((k) => [k, { units: slim(g[k].units) }])),
    dei: dei.EntityCommonStockSharesOutstanding ? { EntityCommonStockSharesOutstanding: { units: slim(dei.EntityCommonStockSharesOutstanding.units) } } : {} } };
}
// Only the fields analyze() reads.
function slim(units) {
  return Object.fromEntries(Object.entries(units).map(([u, es]) => [u, es.map((e) => (e.start
    ? { start: e.start, end: e.end, val: e.val, filed: e.filed } : { end: e.end, val: e.val, filed: e.filed }))]));
}
export function trimSubs(s) {
  const r = s.filings.recent, n = Math.min(r.form.length, 200);
  const keep = ["accessionNumber", "filingDate", "reportDate", "form", "primaryDocument", "primaryDocDescription"];
  return { cik: s.cik, name: s.name, tickers: s.tickers, exchanges: s.exchanges, sicDescription: s.sicDescription, fiscalYearEnd: s.fiscalYearEnd,
    filings: { recent: Object.fromEntries(keep.map((k) => [k, r[k].slice(0, n)])) } };
}
