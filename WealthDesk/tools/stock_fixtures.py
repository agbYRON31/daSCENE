"""Downloads the public data the stock-screen checks run against and trims it to what the
screen uses, so the fixtures stay small. Run by hand: python3 tools/stock_fixtures.py
Prices: Yahoo Finance chart feed (unofficial). Fundamentals and filings: SEC EDGAR."""
import json, sys, time, urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "Tests" / "stock_fixtures"
import os
# The SEC asks automated tools to name a contact; set SEC_CONTACT in your environment (never committed).
SEC_UA = ("WealthDesk/2.0 " + os.environ["SEC_CONTACT"]) if os.environ.get("SEC_CONTACT") else "WealthDesk/2.0 (independent research tool)"
# Concepts the screen reads (from the reference implementation).
from stock_reference import CONCEPTS as _C
CONCEPTS = [c for v in _C.values() for c in v]
FIXTURES = {"AAPL": 320193, "KO": 21344, "JPM": 19617, "NVDA": 1045810, "INTC": 50863}

def get(url, ua):
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def trim_facts(f):
    g = f.get("facts", {}).get("us-gaap", {})
    dei = f.get("facts", {}).get("dei", {})
    return {"cik": f.get("cik"), "entityName": f.get("entityName"), "facts": {
        "us-gaap": {k: {"units": slim(g[k]["units"])} for k in CONCEPTS if k in g},
        "dei": {k: {"units": slim(dei[k]["units"])} for k in ["EntityCommonStockSharesOutstanding"] if k in dei}}}

def slim(units):
    keep = ("start", "end", "val", "filed")
    return {u: [{k: e[k] for k in keep if k in e} for e in es] for u, es in units.items()}

def trim_subs(s):
    r = s["filings"]["recent"]
    keep = ["accessionNumber", "filingDate", "reportDate", "form", "primaryDocument", "primaryDocDescription"]
    n = min(len(r["form"]), 200)
    return {"cik": s.get("cik"), "name": s.get("name"), "tickers": s.get("tickers"), "exchanges": s.get("exchanges"),
            "sicDescription": s.get("sicDescription"), "fiscalYearEnd": s.get("fiscalYearEnd"),
            "filings": {"recent": {k: r[k][:n] for k in keep}}}

def trim_chart(c):
    r = c["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    keepmeta = ["currency", "symbol", "exchangeName", "instrumentType", "regularMarketTime", "gmtoffset", "regularMarketPrice",
                "chartPreviousClose", "previousClose", "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "longName", "shortName"]
    out = {"meta": {k: r["meta"][k] for k in keepmeta if k in r["meta"]}, "timestamp": r.get("timestamp", []),
           "close": q.get("close", [])}
    if "adjclose" in r["indicators"]:
        out["adjclose"] = r["indicators"]["adjclose"][0]["adjclose"]
    ev = r.get("events", {})
    out["dividends"] = sorted(([v["date"], v["amount"]] for v in ev.get("dividends", {}).values()))
    out["splits"] = sorted(([v["date"], v["numerator"], v["denominator"]] for v in ev.get("splits", {}).values()))
    return out

def yahoo(sym, now, intraday=False):
    from urllib.parse import quote
    if intraday:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(sym)}?range=1d&interval=5m"
    else:
        p1 = now - int((10 * 365.25 + 20) * 86400)
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(sym)}?period1={p1}&period2={now}&interval=1d&events=div%2Csplit&includeAdjustedClose=true"
    return trim_chart(get(url, "Mozilla/5.0 (Macintosh) WealthDesk"))

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    now = int(time.time())
    bench = yahoo("SPY", now)
    for t, cik in FIXTURES.items():
        d = {"symbol": t, "asOf": now, "daily": yahoo(t, now), "intraday": yahoo(t, now, True), "bench": bench,
             "facts": trim_facts(get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", SEC_UA)),
             "subs": trim_subs(get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", SEC_UA))}
        (OUT / f"{t}.json").write_text(json.dumps(d, separators=(",", ":")))
        print(t, (OUT / f"{t}.json").stat().st_size)
        time.sleep(0.5)
