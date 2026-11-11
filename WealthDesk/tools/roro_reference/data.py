"""
Data layer: FRED (API key or keyless CSV fallback) + Yahoo Finance (via yfinance), with an on-disk
cache so a flaky source falls back to the last good copy. `--demo` swaps in synthetic data.
"""
from __future__ import annotations

import io
import os
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from config import HISTORY_START, SECTORS, ASSET_CLASSES

FRED_SERIES = [
    "SAHMREALTIME", "ICSA", "UNRATE", "CFNAIMA3", "PERMIT", "INDPRO",
    "T10Y3M", "T10Y2Y", "NFCI", "DFF", "PCEPILFE", "WALCL", "WTREGEN", "RRPONTSYD", "DGS10",
    "BAMLH0A0HYM2", "BAMLC0A0CM", "BAA10Y",
]

YF_TICKERS = sorted(set(
    ["^GSPC", "^NYA", "RSP", "SPY", "^VIX", "^VIX3M", "^SKEW", "^MOVE", "DX-Y.NYB",
     "SPHB", "SPLV", "HYG", "IEF", "XLY", "XLP", "IWF", "IWD", "HG=F", "GC=F", "AUDJPY=X"]
    + SECTORS + [t for _, ts in ASSET_CLASSES for t in ts]
))

CACHE = Path(__file__).parent / "data_cache"


def load_env(path: Path):
    """Minimal .env reader (KEY=VALUE lines) so python-dotenv isn't required."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _log(msg):
    print(msg, file=sys.stderr)


# ── FRED ───────────────────────────────────────────────────────────────────────
def fetch_fred(sid: str, api_key: str | None) -> pd.Series:
    import requests
    if api_key:
        r = requests.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params=dict(series_id=sid, api_key=api_key, file_type="json", observation_start=HISTORY_START),
            timeout=30,
        )
        r.raise_for_status()
        obs = r.json()["observations"]
        s = pd.Series({o["date"]: o["value"] for o in obs})
    else:
        r = requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv",
                         params=dict(id=sid, cosd=HISTORY_START), timeout=30,
                         headers={"User-Agent": "Mozilla/5.0 roro-composite"})
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        s = pd.Series(df.iloc[:, 1].values, index=df.iloc[:, 0].values)
    s.index = pd.to_datetime(s.index)
    s = pd.to_numeric(s.replace(".", np.nan), errors="coerce").dropna().sort_index()
    s.name = sid
    return s


# ── Yahoo ──────────────────────────────────────────────────────────────────────
def fetch_yahoo(tickers: list[str]) -> dict[str, pd.Series]:
    import yfinance as yf
    out = {}
    df = yf.download(tickers, start=HISTORY_START, auto_adjust=True, progress=False, threads=True,
                     group_by="column")
    close = df["Close"] if isinstance(df.columns, pd.MultiIndex) else df[["Close"]].rename(columns={"Close": tickers[0]})
    for t in tickers:
        if t in close.columns:
            s = close[t].dropna()
            if len(s):
                s.index = pd.to_datetime(s.index).tz_localize(None).normalize()
                out[t] = s.rename(t)
    return out


# ── Cache helpers ──────────────────────────────────────────────────────────────
def _cache_path(kind, sid):
    safe = sid.replace("^", "_").replace("=", "_").replace("/", "_")
    return CACHE / f"{kind}_{safe}.csv"


def _save(kind, s):
    CACHE.mkdir(exist_ok=True)
    s.to_csv(_cache_path(kind, s.name), header=True)


def _load(kind, sid):
    p = _cache_path(kind, sid)
    if not p.exists():
        return None
    df = pd.read_csv(p, index_col=0, parse_dates=True)
    return df.iloc[:, 0].dropna().rename(sid)


# ── Accessor used by factor calcs ──────────────────────────────────────────────
class Data:
    def __init__(self, fred: dict, yahoo: dict, health: list, demo: bool = False):
        self._fred, self._yahoo, self.health, self.demo = fred, yahoo, health, demo
        last = max([s.index[-1] for s in list(fred.values()) + list(yahoo.values()) if s is not None and len(s)])
        self.index = pd.bdate_range(HISTORY_START, last)

    def daily(self, s):
        if s is None:
            return None
        s = s[~s.index.duplicated(keep="last")]
        return s.reindex(self.index.union(s.index)).ffill().reindex(self.index)

    def fred_raw(self, sid):
        return self._fred.get(sid)

    def fred(self, sid):
        return self.daily(self._fred.get(sid))

    def yf(self, t):
        s = self._yahoo.get(t)
        if s is None:
            return None
        s = s[~s.index.duplicated(keep="last")]
        return s.reindex(self.index.union(s.index)).ffill(limit=5).reindex(self.index)

    def yf_raw(self, t):
        return self._yahoo.get(t)


def load_live(offline: bool = False) -> Data:
    """Fetch everything (or use cache when offline / on failure). Records per-series health."""
    api_key = os.environ.get("FRED_API_KEY") or None
    health, fred, yahoo = [], {}, {}
    _log(f"FRED: {'API key' if api_key else 'keyless CSV endpoint'} · {len(FRED_SERIES)} series")
    for sid in FRED_SERIES:
        s, status = None, "ok"
        if not offline:
            for attempt in range(3):
                try:
                    s = fetch_fred(sid, api_key)
                    _save("fred", s)
                    break
                except Exception as e:  # noqa: BLE001
                    err = str(e)[:120]
                    time.sleep(1 + attempt)
            else:
                status = f"fetch failed ({err}); using cache"
        if s is None:
            s = _load("fred", sid)
            if s is None:
                status = "missing"
            elif offline:
                status = "cache (offline)"
        fred[sid] = s
        health.append(dict(source="FRED", id=sid, status=status,
                           last=None if s is None else s.index[-1].strftime("%Y-%m-%d")))

    _log(f"Yahoo: {len(YF_TICKERS)} tickers")
    got = {}
    if not offline:
        try:
            got = fetch_yahoo(YF_TICKERS)
            missing = [t for t in YF_TICKERS if t not in got]
            if missing:   # retry stragglers once, individually
                for t in missing:
                    try:
                        got.update(fetch_yahoo([t]))
                    except Exception:  # noqa: BLE001
                        pass
            for s in got.values():
                _save("yf", s)
        except Exception as e:  # noqa: BLE001
            _log(f"  Yahoo download failed: {e}")
    for t in YF_TICKERS:
        s, status = got.get(t), "ok"
        if s is None:
            s = _load("yf", t)
            status = "missing" if s is None else ("cache (offline)" if offline else "fetch failed; using cache")
        yahoo[t] = s
        health.append(dict(source="Yahoo", id=t, status=status,
                           last=None if s is None else s.index[-1].strftime("%Y-%m-%d")))
    return Data(fred, yahoo, health)


# ── Synthetic data for --demo (pipeline testing only) ─────────────────────────────
def load_demo(seed: int = 7) -> Data:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(HISTORY_START, date.today())
    n = len(idx)
    # Latent risk cycle: smooth AR(1) with occasional shocks
    shocks = rng.normal(0, 1, n)
    shocks[rng.random(n) < 0.004] -= 8
    r = np.zeros(n)
    for i in range(1, n):
        r[i] = 0.995 * r[i - 1] + 0.1 * shocks[i]
    r = pd.Series(r / r.std(), index=idx)
    dr = r.diff().fillna(0)

    def level(base, beta, noise, lo=None, hi=None, smooth=20):
        x = base + beta * r.rolling(smooth, min_periods=1).mean() + pd.Series(rng.normal(0, noise, n), index=idx).rolling(5, min_periods=1).mean()
        return x.clip(lo, hi)

    def price(start, drift, beta, vol):
        ret = drift / 252 + beta * dr * 0.02 + rng.normal(0, vol / np.sqrt(252), n)
        return pd.Series(start * np.exp(np.cumsum(ret)), index=idx)

    def monthly(s):
        return s.resample("MS").mean()

    def weekly(s):
        return s.resample("W-FRI").last()

    f = {
        "SAHMREALTIME": monthly(level(0.25, -0.25, 0.05, lo=-0.3)),
        "ICSA": weekly(level(260_000, -50_000, 8_000, lo=180_000)),
        "UNRATE": monthly(level(5.0, -1.0, 0.1, lo=3.4)),
        "CFNAIMA3": monthly(level(0.0, 0.3, 0.1)),
        "PERMIT": monthly(level(1300, 300, 40, lo=500)),
        "INDPRO": monthly(price(90, 0.015, 1.0, 0.03)),
        "T10Y3M": level(1.2, 0.8, 0.1),
        "T10Y2Y": level(0.9, 0.6, 0.08),
        "NFCI": weekly(level(-0.3, -0.35, 0.05)),
        "DFF": level(2.0, 1.2, 0.05, lo=0.05),
        "PCEPILFE": monthly(price(80, 0.022, 0.2, 0.01)),
        "WALCL": weekly(price(2_000_000, 0.07, -0.5, 0.05)),
        "WTREGEN": weekly(level(400_000, 0, 80_000, lo=50_000)),
        "RRPONTSYD": level(300, -100, 50, lo=0),
        "DGS10": level(3.5, 0.6, 0.08, lo=0.5),
        "BAMLH0A0HYM2": level(4.8, -1.4, 0.15, lo=2.6),
        "BAMLC0A0CM": level(1.4, -0.35, 0.05, lo=0.7),
        "BAA10Y": level(2.4, -0.6, 0.06, lo=1.3),
    }
    spx = price(1300, 0.07, 1.0, 0.16)
    y = {
        "^GSPC": spx, "SPY": spx / 10, "^NYA": price(6500, 0.05, 1.0, 0.15),
        "RSP": price(30, 0.065, 1.1, 0.17),
        "^VIX": level(18, -5, 1.5, lo=9, smooth=5), "^VIX3M": level(20, -3.5, 1.0, lo=11, smooth=5),
        "^SKEW": level(132, 4, 4, lo=110), "^MOVE": level(95, -20, 5, lo=50),
        "DX-Y.NYB": price(95, 0.0, -0.3, 0.07),
        "HG=F": price(3, 0.03, 1.2, 0.22), "GC=F": price(400, 0.07, -0.4, 0.16),
        "AUDJPY=X": price(80, 0.0, 0.8, 0.11),
    }
    betas = {"SPHB": 1.6, "SPLV": 0.5, "HYG": 0.5, "IEF": -0.2, "IWF": 1.1, "IWD": 0.9,
             "DBC": 0.6, "GLD": -0.2, "UUP": -0.2, "IWM": 1.3, "QQQ": 1.2, "BIL": 0, "SHV": 0,
             "AGG": -0.1, "TLT": -0.4, "EFA": 0.9, "EEM": 1.2, "BTC-USD": 2.5, "ETH-USD": 3.0}
    for t in YF_TICKERS:
        if t not in y:
            b = betas.get(t, 1.0 if t in SECTORS else 0.5)
            y[t] = price(50, 0.05 if t not in ("BIL", "SHV") else 0.02, b, 0.02 if t in ("BIL", "SHV") else 0.12 + 0.08 * abs(b))
    health = [dict(source="DEMO", id=k, status="synthetic", last=idx[-1].strftime("%Y-%m-%d")) for k in list(f) + list(y)]
    return Data({k: v.dropna() for k, v in f.items()}, {k: v.dropna() for k, v in y.items()}, health, demo=True)
