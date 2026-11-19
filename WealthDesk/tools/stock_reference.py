"""Reference implementation of the stock research screen's numbers.

Written separately from web/stock.js and Sources/WealthCore/Stock.swift from the same written
rules (below), so web/stock-check.mjs can compare all three on saved public data.

Input: one fixture (see tools/stock_fixtures.py): Yahoo chart data (daily for ~10 years, today's
intraday, and SPY as the S&P 500 benchmark) plus the SEC's XBRL company facts and filing list.

Rules
- Dates are exchange-local calendar days: (timestamp + gmtoffset) as a UTC date.
- Returns use adjusted closes (dividends reinvested). A period's start is the last trading day on or
  before the same calendar date that many months/years earlier (YTD: the last day of last year).
  No figure if the history doesn't reach back that far. 3, 5 and 10 years are annualized by calendar days.
- Volatility: sample standard deviation of daily log returns over the last 365 days, x sqrt(252).
- Beta: complete calendar months only (the current month is left out), last 60 monthly returns
  (at least 24), covariance with SPY / variance of SPY.
- Max drawdown: largest fall from a running peak of adjusted closes over the whole history.
- SEC values: the latest-filed figure for each period. Per-share figures and share counts are put
  on today's share basis using the splits Yahoo reports after the filing date.
- Debt and D&A: the total when reported, else the sum of its parts. Balance-sheet figures more
  than 200 days older than the latest results are left out rather than shown stale.
- Fiscal years: ends of annual (340-390 day) revenue or net income periods, the latest 10.
- Trailing twelve months: last fiscal year + this year to date - the same period a year earlier,
  when the year-to-date figures exist; otherwise the last fiscal year.
- Valuation history: the split-adjusted close on the fiscal year's last trading day.
  Medians need at least 3 years.
"""
import json, math, sys
from datetime import date, datetime, timezone

CONCEPTS = {
    "revenue": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
                "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
    "grossProfit": ["GrossProfit"],
    "opIncome": ["OperatingIncomeLoss"],
    "netIncome": ["NetIncomeLoss"],
    "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"],
    "shares": ["WeightedAverageNumberOfDilutedSharesOutstanding"],
    "ocf": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "daTotal": ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"],
    "daDepreciation": ["Depreciation"],
    "daAmortization": ["AmortizationOfIntangibleAssets"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    "debtTotal": ["LongTermDebt", "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"],
    "debtNoncurrent": ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"],
    "debtCurrent": ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
    "equity": ["StockholdersEquity"],
    "dps": ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
}
UNIT = {"eps": "USD/shares", "dps": "USD/shares", "shares": "shares"}
PER_SHARE = {"eps", "dps"}
FLOWS = ["revenue", "grossProfit", "opIncome", "netIncome", "eps", "shares", "ocf", "capex", "dps"]
# A total, or the sum of two parts when only the parts are reported (a missing part counts as 0).
COMPOSITE = {"da": ("daTotal", "daDepreciation", "daAmortization"), "debt": ("debtTotal", "debtNoncurrent", "debtCurrent")}
STALE_DAYS = 200  # a balance-sheet figure older than this before the latest results isn't shown
FILING_FORMS = {"10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "20-F", "40-F", "6-K", "DEF 14A", "S-1"}
PERIODS = [("1M", 1, 0), ("3M", 3, 0), ("6M", 6, 0), ("YTD", 0, 0), ("1Y", 0, 1), ("3Y", 0, 3), ("5Y", 0, 5), ("10Y", 0, 10)]
EPOCH = date(1970, 1, 1)


def dnum(s):
    return (date.fromisoformat(s[:10]) - EPOCH).days


def dstr(n):
    return None if n is None else date.fromordinal(EPOCH.toordinal() + n).isoformat()


def ts_day(ts, off):
    return (datetime.fromtimestamp(ts + off, tz=timezone.utc).date() - EPOCH).days


def shift(day, months=0, years=0):
    d = date.fromordinal(EPOCH.toordinal() + day)
    m = d.year * 12 + (d.month - 1) - months - 12 * years
    y, mo = divmod(m, 12)
    mo += 1
    last = (date(y + (mo == 12), mo % 12 + 1, 1) - date(y, mo, 1)).days
    return (date(y, mo, min(d.day, last)) - EPOCH).days


def series(ch):
    off = ch["meta"].get("gmtoffset", 0)
    adj = ch.get("adjclose") or ch["close"]
    out = []
    for i, t in enumerate(ch["timestamp"]):
        c, a = ch["close"][i], adj[i]
        if c is None or a is None:
            continue
        day = ts_day(t, off)
        if out and out[-1][0] == day:
            out[-1] = (day, c, a)
        else:
            out.append((day, c, a))
    return out


def at_or_before(s, day):
    lo, hi, k = 0, len(s) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if s[mid][0] <= day:
            k, lo = mid, mid + 1
        else:
            hi = mid - 1
    return k


def period_returns(s):
    out = {}
    if not s:
        return {k: None for k, _, _ in PERIODS}
    last = s[-1]
    for key, mo, yr in PERIODS:
        if key == "YTD":
            y = date.fromordinal(EPOCH.toordinal() + last[0]).year
            target = (date(y - 1, 12, 31) - EPOCH).days
        else:
            target = shift(last[0], mo, yr)
        k = at_or_before(s, target)
        if k is None:
            out[key] = None
            continue
        r = last[2] / s[k][2] - 1
        if yr >= 3:
            days = last[0] - s[k][0]
            r = (1 + r) ** (365.25 / days) - 1
        out[key] = r
    return out


def mean(v):
    return sum(v) / len(v)


def volatility(s):
    if len(s) < 2:
        return None
    start = s[-1][0] - 365
    r = [math.log(s[i][2] / s[i - 1][2]) for i in range(1, len(s)) if s[i][0] > start]
    if len(r) < 20:
        return None
    m = mean(r)
    return math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1)) * math.sqrt(252)


def month_ends(s):
    out = {}
    if not s:
        return out
    lastm = None
    d = date.fromordinal(EPOCH.toordinal() + s[-1][0])
    cur = d.year * 12 + d.month - 1
    for day, _, a in s:
        d = date.fromordinal(EPOCH.toordinal() + day)
        m = d.year * 12 + d.month - 1
        if m < cur:
            out[m] = a
    return out


def beta(s, b):
    ms, mb = month_ends(s), month_ends(b)
    keys = sorted(k for k in ms if k in mb and (k - 1) in ms and (k - 1) in mb)
    keys = keys[-60:]
    if len(keys) < 24:
        return None, len(keys)
    x = [ms[k] / ms[k - 1] - 1 for k in keys]
    y = [mb[k] / mb[k - 1] - 1 for k in keys]
    mx, my = mean(x), mean(y)
    var = sum((v - my) ** 2 for v in y)
    return sum((x[i] - mx) * (y[i] - my) for i in range(len(x))) / var, len(keys)


def drawdown(s):
    if not s:
        return None
    peak, peak_day = s[0][2], s[0][0]
    best = (0.0, None, None)
    for day, _, a in s:
        if a > peak:
            peak, peak_day = a, day
        dd = 1 - a / peak
        if dd > best[0]:
            best = (dd, peak_day, day)
    rec = None
    if best[1] is not None:
        pk = next(a for d, _, a in s if d == best[1])
        rec = next((d for d, _, a in s if d > best[2] and a >= pk), None)
    run_peak = max(a for _, _, a in s)
    return {"maxDD": best[0], "peakDay": dstr(best[1]), "troughDay": dstr(best[2]), "recoveryDay": dstr(rec),
            "currentDD": 1 - s[-1][2] / run_peak}


class Facts:
    def __init__(self, facts, splits):
        self.g = (facts or {}).get("facts", {}).get("us-gaap", {})
        self.dei = (facts or {}).get("facts", {}).get("dei", {})
        self.splits = splits

    def factor(self, filed):
        f = 1.0
        for day, num, den in self.splits:
            if day > filed:
                f *= num / den
        return f

    def entries(self, concept, unit):
        out = []
        for i, e in enumerate(self.g.get(concept, {}).get("units", {}).get(unit, [])):
            out.append({"start": dnum(e["start"]) if e.get("start") else None, "end": dnum(e["end"]),
                        "val": e["val"], "filed": dnum(e["filed"]), "i": i})
        return out

    def adjust(self, key, val, filed):
        if key in PER_SHARE:
            return val / self.factor(filed)
        if key == "shares":
            return val * self.factor(filed)
        return val

    def best(self, cands, target):
        return max(cands, key=lambda e: (e["filed"], -abs(e["end"] - target), e["i"]))

    def value_at(self, key, end, flow):
        unit = UNIT.get(key, "USD")
        for c in CONCEPTS[key]:
            cands = [e for e in self.entries(c, unit) if abs(e["end"] - end) <= 7 and
                     ((e["start"] is not None and 340 <= e["end"] - e["start"] <= 390) if flow else e["start"] is None)]
            if cands:
                e = self.best(cands, end)
                return self.adjust(key, e["val"], e["filed"])
        return None

    def fiscal_ends(self):
        ends = set()
        for key in ["revenue", "netIncome"]:
            for c in CONCEPTS[key]:
                for e in self.entries(c, "USD"):
                    if e["start"] is not None and 340 <= e["end"] - e["start"] <= 390:
                        ends.add(e["end"])
        kept = []
        for d in sorted(ends, reverse=True):
            if all(abs(d - k) > 7 for k in kept):
                kept.append(d)
        return sorted(kept[:10])

    def ttm(self, key, fy_end):
        unit = UNIT.get(key, "USD")
        for c in CONCEPTS[key]:
            es = self.entries(c, unit)
            fy = [e for e in es if e["start"] is not None and abs(e["end"] - fy_end) <= 7 and 340 <= e["end"] - e["start"] <= 390]
            if not fy:
                continue
            f = self.best(fy, fy_end)
            fv = self.adjust(key, f["val"], f["filed"])
            ytd = [e for e in es if e["start"] is not None and 0 < e["start"] - fy_end <= 10 and e["end"] - e["start"] < 340]
            if ytd:
                q_end = max(e["end"] for e in ytd)
                cur = self.best([e for e in ytd if e["end"] == q_end], q_end)
                dur = cur["end"] - cur["start"]
                pr = [e for e in es if e["start"] is not None and abs(e["end"] - (q_end - 365)) <= 10
                      and abs((e["end"] - e["start"]) - dur) <= 10]
                if pr:
                    p = self.best(pr, q_end - 365)
                    return (fv + self.adjust(key, cur["val"], cur["filed"]) - self.adjust(key, p["val"], p["filed"]), q_end)
            return (fv, f["end"])
        return (None, None)

    def latest_instant(self, keys):
        ends = [e["end"] for k in keys for c in CONCEPTS[k] for e in self.entries(c, UNIT.get(k, "USD")) if e["start"] is None]
        return max(ends) if ends else None

    def composite_at(self, key, end, flow):
        total, p1, p2 = COMPOSITE[key]
        t = self.value_at(total, end, flow)
        if t is not None:
            return t
        a, c = self.value_at(p1, end, flow), self.value_at(p2, end, flow)
        if a is None and c is None:
            return None
        return (a or 0) + (c or 0)

    def composite_ttm(self, key, fy_end):
        total, p1, p2 = COMPOSITE[key]
        t = self.ttm(total, fy_end)
        if t[0] is not None:
            return t
        a, c = self.ttm(p1, fy_end), self.ttm(p2, fy_end)
        if a[0] is None and c[0] is None:
            return (None, None)
        return ((a[0] or 0) + (c[0] or 0), a[1] if a[0] is not None else c[1])

    def shares_out(self):
        es = self.dei.get("EntityCommonStockSharesOutstanding", {}).get("units", {}).get("shares", [])
        if not es:
            return None, None
        e = max(enumerate(es), key=lambda p: (dnum(p[1]["end"]), dnum(p[1]["filed"]), p[0]))[1]
        return e["val"] * self.factor(dnum(e["filed"])), dnum(e["end"])


def sma(c, n):
    out = []
    for i in range(len(c)):
        out.append(None if i < n - 1 else sum(c[i - n + 1:i + 1]) / n)
    return out


def bollinger(c, n=20, k=2):
    mid = sma(c, n)
    up, lo = [], []
    for i, m in enumerate(mid):
        if m is None:
            up.append(None); lo.append(None); continue
        sd = math.sqrt(sum((x - m) ** 2 for x in c[i - n + 1:i + 1]) / n)
        up.append(m + k * sd); lo.append(m - k * sd)
    return mid, up, lo


def rsi(c, n=14):
    """Wilder's RSI: first average over n changes, then (prev*(n-1) + current)/n."""
    out = [None] * len(c)
    if len(c) <= n:
        return out
    ch = [c[i] - c[i - 1] for i in range(1, len(c))]
    g = sum(max(d, 0) for d in ch[:n]) / n
    l = sum(max(-d, 0) for d in ch[:n]) / n
    val = lambda: (50 if g == 0 else 100) if l == 0 else 100 - 100 / (1 + g / l)
    out[n] = val()
    for i in range(n + 1, len(c)):
        d = c[i] - c[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n
        l = (l * (n - 1) + max(-d, 0)) / n
        out[i] = val()
    return out


FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]


def fib_levels(c):
    hi, lo = max(c), min(c)
    return [{"ratio": r, "price": hi - (hi - lo) * r} for r in FIB_RATIOS]


def div(a, b):
    return None if a is None or b is None or b == 0 else a / b


def pos_div(a, b):
    return None if a is None or b is None or b <= 0 else a / b


def median(v):
    v = sorted(x for x in v if x is not None)
    if len(v) < 3:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def analyze(fx):
    daily, bench = fx["daily"], fx["bench"]
    intra = fx.get("intraday") or {"meta": {}}
    meta = daily["meta"]
    s, b = series(daily), series(bench)
    off = meta.get("gmtoffset", 0)
    price = intra["meta"].get("regularMarketPrice", meta.get("regularMarketPrice"))
    prev = intra["meta"].get("chartPreviousClose")
    if prev is None:
        prev = s[-2][1] if len(s) > 1 else None
    rs, rb = period_returns(s), period_returns(b)
    bt, months = beta(s, b)
    divs = [(ts_day(t, off), a) for t, a in daily.get("dividends", [])]
    last = s[-1][0] if s else None
    ttm_div = sum(a for d, a in divs if d > last - 365) if s else None
    yr = date.fromordinal(EPOCH.toordinal() + last).year if s else None
    by_year = {}
    for d, a in divs:
        y = date.fromordinal(EPOCH.toordinal() + d).year
        by_year[y] = by_year.get(y, 0) + a
    a1, a6 = by_year.get(yr - 1, 0) if s else 0, by_year.get(yr - 6, 0) if s else 0
    growth5 = (a1 / a6) ** 0.2 - 1 if a1 > 0 and a6 > 0 else None

    splits = [(ts_day(t, off), n, d) for t, n, d in daily.get("splits", [])]
    F = Facts(fx.get("facts"), splits)
    ends = F.fiscal_ends()
    rows = []
    for e in ends:
        r = {"end": dstr(e)}
        for k in FLOWS:
            r[k] = F.value_at(k, e, True)
        r["cash"] = F.value_at("cash", e, False)
        r["equity"] = F.value_at("equity", e, False)
        r["debt"] = F.composite_at("debt", e, False)
        r["da"] = F.composite_at("da", e, True)
        r["fcf"] = None if r["ocf"] is None or r["capex"] is None else r["ocf"] - r["capex"]
        for m, k in [("grossMargin", "grossProfit"), ("opMargin", "opIncome"), ("netMargin", "netIncome"), ("fcfMargin", "fcf")]:
            r[m] = pos_div(r[k], r["revenue"])
        k = at_or_before(s, e)
        r["price"] = s[k][1] if k is not None and e >= s[0][0] else None
        mcap = None if r["price"] is None or r["shares"] is None else r["price"] * r["shares"]
        r["pe"] = pos_div(r["price"], r["eps"])
        r["ps"] = pos_div(mcap, r["revenue"])
        r["fcfYield"] = div(r["fcf"], mcap)
        ebitda = None if r["opIncome"] is None or r["da"] is None else r["opIncome"] + r["da"]
        ev = None if mcap is None else mcap + (r["debt"] or 0) - (r["cash"] or 0)
        r["evEbitda"] = pos_div(ev, ebitda)
        rows.append(r)
    for i, r in enumerate(rows):
        p = rows[i - 1] if i else None
        r["revGrowth"] = None if not p else (None if p["revenue"] is None or r["revenue"] is None or p["revenue"] <= 0 else r["revenue"] / p["revenue"] - 1)
        r["epsGrowth"] = None if not p else (None if p["eps"] is None or r["eps"] is None or p["eps"] <= 0 else r["eps"] / p["eps"] - 1)

    ttm = {}
    if ends:
        for k in ["revenue", "grossProfit", "opIncome", "netIncome", "eps", "ocf", "capex", "da"]:
            v, through = F.composite_ttm(k, ends[-1]) if k in COMPOSITE else F.ttm(k, ends[-1])
            ttm[k] = v
            if k in ("revenue", "eps"):
                ttm[k + "Through"] = dstr(through)
    ttm["fcf"] = None if ttm.get("ocf") is None or ttm.get("capex") is None else ttm["ocf"] - ttm["capex"]
    ttm["ebitda"] = None if ttm.get("opIncome") is None or ttm.get("da") is None else ttm["opIncome"] + ttm["da"]

    bal = {}
    ref = None
    if ends:
        ref = max([ends[-1]] + [dnum(ttm[k]) for k in ("revenueThrough", "epsThrough") if ttm.get(k)])
    for key, parts in [("cash", ["cash"]), ("equity", ["equity"]), ("debt", list(COMPOSITE["debt"]))]:
        e = F.latest_instant(parts)
        if e is not None and ref is not None and e < ref - STALE_DAYS:
            e = None
        bal[key] = None if e is None else (F.composite_at(key, e, False) if key in COMPOSITE else F.value_at(key, e, False))
        bal[key + "AsOf"] = dstr(e)
    so, so_end = F.shares_out()
    if so is None and rows:
        so, so_end = rows[-1]["shares"], dnum(rows[-1]["end"])
    bal["sharesOut"], bal["sharesAsOf"] = so, dstr(so_end)

    mcap = None if price is None or so is None else price * so
    ev = None if mcap is None else mcap + (bal["debt"] or 0) - (bal["cash"] or 0)
    val = {"marketCap": mcap, "ev": ev, "pe": pos_div(price, ttm.get("eps")), "ps": pos_div(mcap, ttm.get("revenue")),
           "pb": pos_div(mcap, bal["equity"]), "evEbitda": pos_div(ev, ttm.get("ebitda")), "fcfYield": div(ttm.get("fcf"), mcap),
           "divYield": div(ttm_div, price),
           "medians": {k: median([r[k] for r in rows]) for k in ["pe", "ps", "evEbitda", "fcfYield"]}}

    growth = {"revenueCAGR": None, "epsCAGR": None, "years": None}
    if len(rows) >= 2:
        f, l = rows[0], rows[-1]
        yrs = (dnum(l["end"]) - dnum(f["end"])) / 365.25
        growth["years"] = yrs
        if f["revenue"] and l["revenue"] and f["revenue"] > 0 and l["revenue"] > 0:
            growth["revenueCAGR"] = (l["revenue"] / f["revenue"]) ** (1 / yrs) - 1
        if f["eps"] and l["eps"] and f["eps"] > 0 and l["eps"] > 0:
            growth["epsCAGR"] = (l["eps"] / f["eps"]) ** (1 / yrs) - 1

    filings = []
    subs = fx.get("subs")
    if subs:
        r = subs["filings"]["recent"]
        cik = int(subs["cik"])
        for i, form in enumerate(r["form"]):
            if form in FILING_FORMS:
                filings.append({"date": r["filingDate"][i], "form": form,
                                "description": r["primaryDocDescription"][i] or form,
                                "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{r['accessionNumber'][i].replace('-', '')}/{r['primaryDocument'][i]}"})
            if len(filings) == 15:
                break

    return {
        "symbol": meta.get("symbol"), "name": meta.get("longName") or meta.get("shortName"),
        "quote": {"price": price, "prevClose": prev, "change": None if prev is None else price - prev,
                  "changePct": None if not prev else price / prev - 1, "high52": meta.get("fiftyTwoWeekHigh"),
                  "low52": meta.get("fiftyTwoWeekLow"), "lastDay": dstr(last)},
        "returns": [{"key": k, "stock": rs[k], "bench": rb[k]} for k, _, _ in PERIODS],
        "risk": {"vol1y": volatility(s), "benchVol1y": volatility(b), "beta5y": bt, "betaMonths": months, **(drawdown(s) or {})},
        "dividends": {"ttm": ttm_div, "yield": div(ttm_div, price), "growth5": growth5},
        "annual": rows, "ttm": ttm, "balance": bal, "valuation": val, "growth": growth, "filings": filings,
        "indicators": (lambda c: (lambda bb: {"sma50": sma(c, 50), "sma200": sma(c, 200), "bbMid": bb[0], "bbUp": bb[1], "bbLo": bb[2],
                                              "rsi14": rsi(c, 14), "fib": fib_levels(c)})(bollinger(c)))([x[1] for x in s]),
    }


if __name__ == "__main__":
    print(json.dumps(analyze(json.load(open(sys.argv[1])))))
