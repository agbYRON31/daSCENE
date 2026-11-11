"""
RoRo Composite — factor universe, bucket weights and scenario definitions.

Everything you'd want to tune lives here:
  * FACTORS          — each signal: how it's computed, how it maps to a −100…+100 score, its weight
  * HORIZON_WEIGHTS  — how the six buckets combine into the Tactical / Intermediate / Strategic dials
  * SCENARIOS        — forward "what-if" shocks, expressed as overrides to raw factor readings

Score maps are piecewise-linear: a list of (raw_reading, score) points, linearly interpolated
and clamped at the ends. Higher score = more risk-on. Edit the points to change sensitivity.
"""

# ── Data window ────────────────────────────────────────────────────────────────
HISTORY_START = "1999-01-01"      # enough runway for 200-DMAs and analogs back to ~2003

# ── Buckets ────────────────────────────────────────────────────────────────────
BUCKETS = [
    ("MACRO",       "Macro / Growth"),
    ("MONETARY",    "Monetary / Liquidity"),
    ("TECHNICALS",  "Technicals / Breadth"),
    ("CREDIT",      "Credit"),
    ("VOL",         "Vol / Sentiment"),
    ("CROSS",       "Cross-Asset"),
]

# Bucket weights per horizon (normalised automatically; missing buckets are re-weighted away)
HORIZON_WEIGHTS = {
    "tactical":     {"MACRO": 5,  "MONETARY": 10, "TECHNICALS": 30, "CREDIT": 15, "VOL": 25, "CROSS": 15},
    "intermediate": {"MACRO": 15, "MONETARY": 15, "TECHNICALS": 25, "CREDIT": 20, "VOL": 10, "CROSS": 15},
    "strategic":    {"MACRO": 30, "MONETARY": 25, "TECHNICALS": 10, "CREDIT": 20, "VOL": 5,  "CROSS": 10},
}
# Smoothing (EMA span, trading days) applied to each horizon's raw composite
HORIZON_SMOOTHING = {"tactical": 1, "intermediate": 5, "strategic": 20}

HORIZON_META = {
    "tactical":     {"label": "Tactical",     "span": "1–4W", "desc": "1 to 4 weeks · forward"},
    "intermediate": {"label": "Intermediate", "span": "1–3M", "desc": "1 to 3 months · forward"},
    "strategic":    {"label": "Strategic",    "span": "3–12M", "desc": "3 to 12 months · forward"},
}

# Posture thresholds (Intermediate dial drives Offense / Defense)
OFFENSE_LINE = 20
DEFENSE_LINE = -20
CRISIS_LINE = -60

# Per-factor signal label thresholds
SIGNAL_ON = 25
SIGNAL_OFF = -25

# ── Helpers used by factor calcs (D is the data accessor from data.py) ─────────
def chg(s, n=63):
    """% change over n trading days."""
    return s.pct_change(n, fill_method=None) * 100

def ratio_chg(a, b, n=63):
    return chg(a / b, n)

def vs_ma(s, n):
    return (s / s.rolling(n, min_periods=int(n * 0.8)).mean() - 1) * 100

def ma_slope(s, n=200, lag=63):
    ma = s.rolling(n, min_periods=int(n * 0.8)).mean()
    return chg(ma, lag)

def native_then_daily(D, sid, fn):
    """Apply fn to a FRED series at its native frequency, then align to the daily index."""
    return D.daily(fn(D.fred_raw(sid)))

SECTORS = ["XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY", "XLC", "XLRE"]

def sector_breadth(D):
    import pandas as pd
    above = []
    for t in SECTORS:
        s = D.yf(t)
        if s is None:
            continue
        ma = s.rolling(200, min_periods=160).mean()
        a = (s > ma).astype(float)
        a[ma.isna()] = float("nan")
        above.append(a)
    if not above:
        return None
    return pd.concat(above, axis=1).mean(axis=1, skipna=True) * 100

def net_liquidity(D):
    walcl, tga, rrp = D.fred_raw("WALCL"), D.fred_raw("WTREGEN"), D.fred_raw("RRPONTSYD")
    if walcl is None or tga is None:
        return None
    walcl, tga = D.daily(walcl), D.daily(tga)
    rrp = D.daily(rrp).fillna(0) * 1000 if rrp is not None else 0   # RRP is in $bn, others $mn
    return walcl - tga - rrp

def real_ffr(D):
    pce = D.fred_raw("PCEPILFE")
    if pce is None or D.fred("DFF") is None:
        return None
    infl = D.daily(pce.pct_change(12, fill_method=None) * 100)
    return D.fred("DFF") - infl

def drawdown_52w(s):
    return (s / s.rolling(252, min_periods=200).max() - 1) * 100


# ── Factor universe ────────────────────────────────────────────────────────────
# fmt: how the raw reading is displayed. weight: within-bucket weight.
# map: piecewise-linear (reading, score) points.  Every calc returns a daily pandas Series or None.
FACTORS = [
    # MACRO / GROWTH ---------------------------------------------------------------
    dict(id="sahm", name="Sahm Rule (real-time)", bucket="MACRO", weight=30, fmt="{:.2f}",
         calc=lambda D: D.fred("SAHMREALTIME"),
         map=[(-0.2, 50), (0.0, 40), (0.3, 0), (0.5, -80), (0.8, -100)],
         src="FRED SAHMREALTIME"),
    dict(id="claims", name="Initial Claims · 4w MA, YoY", bucket="MACRO", weight=25, fmt="{:+.1f}%",
         calc=lambda D: native_then_daily(D, "ICSA", lambda s: s.rolling(4).mean().pct_change(52, fill_method=None) * 100),
         map=[(-10, 50), (0, 20), (10, -20), (20, -60), (35, -100)],
         src="FRED ICSA"),
    dict(id="unrate", name="Unemployment vs 12m MA", bucket="MACRO", weight=20, fmt="{:+.2f} pp",
         calc=lambda D: native_then_daily(D, "UNRATE", lambda s: s - s.rolling(12).mean()),
         map=[(-0.3, 40), (0.0, 20), (0.2, 0), (0.5, -80), (0.8, -100)],
         src="FRED UNRATE"),
    dict(id="cfnai", name="Chicago Fed Activity (CFNAI 3m)", bucket="MACRO", weight=25, fmt="{:+.2f}",
         calc=lambda D: D.fred("CFNAIMA3"),
         map=[(-0.7, -100), (-0.35, -40), (0.0, 10), (0.2, 40), (0.5, 70)],
         src="FRED CFNAIMA3"),
    dict(id="permits", name="Building Permits YoY", bucket="MACRO", weight=15, fmt="{:+.1f}%",
         calc=lambda D: native_then_daily(D, "PERMIT", lambda s: s.pct_change(12, fill_method=None) * 100),
         map=[(-25, -100), (-10, -40), (0, 0), (10, 40), (20, 60)],
         src="FRED PERMIT"),
    dict(id="indpro", name="Industrial Production YoY", bucket="MACRO", weight=15, fmt="{:+.1f}%",
         calc=lambda D: native_then_daily(D, "INDPRO", lambda s: s.pct_change(12, fill_method=None) * 100),
         map=[(-4, -100), (-1, -40), (0, -10), (2, 40), (4, 70)],
         src="FRED INDPRO"),

    # MONETARY / LIQUIDITY -----------------------------------------------------------
    dict(id="t10y3m", name="3m10y Yield Curve", bucket="MONETARY", weight=25, fmt="{:+.2f}%",
         calc=lambda D: D.fred("T10Y3M"),
         map=[(-1.5, -80), (-0.5, -40), (0.0, 0), (0.75, 30), (2.0, 50)],
         src="FRED T10Y3M"),
    dict(id="t10y2y", name="2s10s Yield Curve", bucket="MONETARY", weight=10, fmt="{:+.2f}%",
         calc=lambda D: D.fred("T10Y2Y"),
         map=[(-1.0, -60), (0.0, 0), (1.0, 30), (2.0, 40)],
         src="FRED T10Y2Y"),
    dict(id="nfci", name="Chicago Fed NFCI", bucket="MONETARY", weight=25, fmt="{:+.2f}",
         calc=lambda D: D.fred("NFCI"),
         map=[(-0.6, 60), (-0.3, 25), (0.0, -20), (0.5, -80), (1.0, -100)],
         src="FRED NFCI"),
    dict(id="realffr", name="Real Fed Funds (vs core PCE)", bucket="MONETARY", weight=15, fmt="{:+.2f}%",
         calc=real_ffr,
         map=[(-2, 60), (0, 30), (1, 0), (2, -50), (3, -90)],
         src="FRED DFF, PCEPILFE"),
    dict(id="netliq", name="Net Fed Liquidity (13w Δ)", bucket="MONETARY", weight=25, fmt="{:+.1f}%",
         calc=lambda D: (lambda nl: None if nl is None else chg(nl, 63))(net_liquidity(D)),
         map=[(-5, -100), (-2, -50), (0, 0), (2, 50), (5, 100)],
         src="FRED WALCL − WTREGEN − RRPONTSYD"),
    dict(id="dgs10chg", name="10y Yield · 3m change", bucket="MONETARY", weight=15, fmt="{:+.2f} pp",
         calc=lambda D: (lambda s: None if s is None else s - s.shift(63))(D.fred("DGS10")),
         map=[(-0.75, 40), (0.0, 0), (0.5, -40), (1.0, -80), (1.5, -100)],
         src="FRED DGS10"),

    # TECHNICALS / BREADTH --------------------------------------------------------------
    dict(id="spx200", name="SPX vs. 200-DMA", bucket="TECHNICALS", weight=25, fmt="{:+.1f}%",
         calc=lambda D: vs_ma(D.yf("^GSPC"), 200),
         map=[(-10, -100), (-3, -40), (0, 0), (3, 30), (8, 60), (15, 30)],
         src="Yahoo ^GSPC"),
    dict(id="slope200", name="200-DMA Slope (3m)", bucket="TECHNICALS", weight=20, fmt="{:+.1f}%",
         calc=lambda D: ma_slope(D.yf("^GSPC")),
         map=[(-4, -100), (-1, -40), (0, 0), (1, 40), (4, 100)],
         src="Yahoo ^GSPC"),
    dict(id="spx50", name="SPX vs. 50-DMA", bucket="TECHNICALS", weight=15, fmt="{:+.1f}%",
         calc=lambda D: vs_ma(D.yf("^GSPC"), 50),
         map=[(-6, -80), (-2, -30), (0, 0), (2, 25), (5, 50)],
         src="Yahoo ^GSPC"),
    dict(id="sectbreadth", name="% Sector ETFs above 200-DMA", bucket="TECHNICALS", weight=20, fmt="{:.0f}%",
         calc=sector_breadth,
         map=[(0, -100), (30, -50), (50, 0), (70, 40), (90, 70)],
         src="Yahoo XL* sector SPDRs"),
    dict(id="rspspy", name="Equal-weight vs Cap-weight (RSP:SPY 13w)", bucket="TECHNICALS", weight=10, fmt="{:+.1f}%",
         calc=lambda D: ratio_chg(D.yf("RSP"), D.yf("SPY")),
         map=[(-4, -70), (0, 0), (4, 60)],
         src="Yahoo RSP, SPY"),
    dict(id="nyaspx", name="NYSE Composite vs SPX (13w)", bucket="TECHNICALS", weight=10, fmt="{:+.1f}%",
         calc=lambda D: ratio_chg(D.yf("^NYA"), D.yf("^GSPC")),
         map=[(-4, -70), (0, 0), (4, 60)],
         src="Yahoo ^NYA, ^GSPC"),
    dict(id="dd52", name="SPX Drawdown from 52w High", bucket="TECHNICALS", weight=15, fmt="{:+.1f}%",
         calc=lambda D: drawdown_52w(D.yf("^GSPC")),
         map=[(-20, -100), (-10, -60), (-5, -20), (-2, 10), (0, 30)],
         src="Yahoo ^GSPC"),

    # CREDIT ---------------------------------------------------------------------------
    dict(id="hyoas", name="HY OAS", bucket="CREDIT", weight=30, fmt="{:.0f} bp", scale=100,
         calc=lambda D: D.fred("BAMLH0A0HYM2"),
         map=[(3.0, 60), (3.5, 40), (4.5, 0), (6.0, -60), (8.0, -100)],
         src="FRED BAMLH0A0HYM2"),
    dict(id="igoas", name="IG OAS", bucket="CREDIT", weight=20, fmt="{:.0f} bp", scale=100,
         calc=lambda D: D.fred("BAMLC0A0CM"),
         map=[(0.8, 50), (1.0, 30), (1.4, 0), (2.0, -60), (3.0, -100)],
         src="FRED BAMLC0A0CM"),
    dict(id="hyig", name="HY/IG Spread Ratio", bucket="CREDIT", weight=15, fmt="{:.2f}",
         calc=lambda D: (lambda h, i: None if h is None or i is None else h / i)(D.fred("BAMLH0A0HYM2"), D.fred("BAMLC0A0CM")),
         map=[(2.8, 40), (3.5, 0), (4.0, -40), (5.0, -80)],
         src="FRED (derived)"),
    dict(id="hychg", name="HY OAS · 3m change", bucket="CREDIT", weight=20, fmt="{:+.0f} bp", scale=100,
         calc=lambda D: (lambda s: None if s is None else s - s.shift(63))(D.fred("BAMLH0A0HYM2")),
         map=[(-0.75, 40), (0.0, 10), (0.5, -40), (1.5, -100)],
         src="FRED BAMLH0A0HYM2"),
    dict(id="baa10y", name="Moody's Baa − 10y Treasury", bucket="CREDIT", weight=15, fmt="{:.2f}%",
         calc=lambda D: D.fred("BAA10Y"),
         map=[(1.5, 40), (2.0, 10), (2.5, -20), (3.5, -80), (5.0, -100)],
         src="FRED BAA10Y"),

    # VOL / SENTIMENT ----------------------------------------------------------------------
    dict(id="vix", name="VIX (Colas regime, contrarian)", bucket="VOL", weight=25, fmt="{:.1f}",
         calc=lambda D: D.yf("^VIX"),
         map=[(10, -30), (13, 0), (19.5, 10), (27.3, 40), (35, 70), (43, 100)],
         src="Yahoo ^VIX"),
    dict(id="vixterm", name="VIX / VIX3M Term Structure", bucket="VOL", weight=25, fmt="{:.2f}",
         calc=lambda D: (lambda a, b: None if a is None or b is None else a / b)(D.yf("^VIX"), D.yf("^VIX3M")),
         map=[(0.8, 40), (0.9, 20), (1.0, -20), (1.1, -70), (1.2, -100)],
         src="Yahoo ^VIX, ^VIX3M"),
    dict(id="skew", name="SKEW Index", bucket="VOL", weight=15, fmt="{:.0f}",
         calc=lambda D: D.yf("^SKEW"),
         map=[(120, 30), (135, 0), (150, -35), (165, -60)],
         src="Yahoo ^SKEW"),
    dict(id="move", name="MOVE Index (bond vol)", bucket="VOL", weight=20, fmt="{:.0f}",
         calc=lambda D: D.yf("^MOVE"),
         map=[(70, 40), (90, 20), (110, -10), (130, -50), (160, -100)],
         src="Yahoo ^MOVE"),
    dict(id="vixspike", name="VIX · 1m change", bucket="VOL", weight=15, fmt="{:+.1f} pts",
         calc=lambda D: (lambda s: None if s is None else s - s.shift(21))(D.yf("^VIX")),
         map=[(-5, 30), (0, 0), (5, -40), (10, -80), (20, -100)],
         src="Yahoo ^VIX"),

    # CROSS-ASSET (13-week % change of risk-appetite ratios) -----------------------------
    dict(id="sphb", name="SPHB:SPLV (HiBeta/LowVol)", bucket="CROSS", weight=15, fmt="{:+.1f}%",
         calc=lambda D: ratio_chg(D.yf("SPHB"), D.yf("SPLV")),
         map=[(-8, -80), (0, 0), (8, 80)], src="Yahoo SPHB, SPLV"),
    dict(id="hygief", name="HYG:IEF (HY/Treasury)", bucket="CROSS", weight=15, fmt="{:+.1f}%",
         calc=lambda D: ratio_chg(D.yf("HYG"), D.yf("IEF")),
         map=[(-4, -80), (0, 0), (4, 80)], src="Yahoo HYG, IEF"),
    dict(id="xlyxlp", name="XLY:XLP (Disc/Staples)", bucket="CROSS", weight=15, fmt="{:+.1f}%",
         calc=lambda D: ratio_chg(D.yf("XLY"), D.yf("XLP")),
         map=[(-8, -80), (0, 0), (8, 80)], src="Yahoo XLY, XLP"),
    dict(id="iwfiwd", name="Growth/Value (IWF:IWD)", bucket="CROSS", weight=10, fmt="{:+.1f}%",
         calc=lambda D: ratio_chg(D.yf("IWF"), D.yf("IWD")),
         map=[(-8, -60), (0, 0), (8, 60)], src="Yahoo IWF, IWD"),
    dict(id="cugold", name="Copper:Gold (13w)", bucket="CROSS", weight=15, fmt="{:+.1f}%",
         calc=lambda D: ratio_chg(D.yf("HG=F"), D.yf("GC=F")),
         map=[(-10, -80), (0, 0), (10, 80)], src="Yahoo HG=F, GC=F"),
    dict(id="spxgold", name="SPX:Gold (13w)", bucket="CROSS", weight=10, fmt="{:+.1f}%",
         calc=lambda D: ratio_chg(D.yf("^GSPC"), D.yf("GC=F")),
         map=[(-10, -80), (0, 0), (10, 80)], src="Yahoo ^GSPC, GC=F"),
    dict(id="dxy", name="DXY Trend (vs 200-DMA)", bucket="CROSS", weight=10, fmt="{:+.1f}%",
         calc=lambda D: vs_ma(D.yf("DX-Y.NYB"), 200),
         map=[(-4, 40), (0, 0), (4, -50)], src="Yahoo DX-Y.NYB"),
    dict(id="audjpy", name="AUD/JPY (13w)", bucket="CROSS", weight=10, fmt="{:+.1f}%",
         calc=lambda D: chg(D.yf("AUDJPY=X")),
         map=[(-6, -80), (0, 0), (6, 80)], src="Yahoo AUDJPY=X"),
]

# ── Asset-class leadership (§05) ──────────────────────────────────────────────────
ASSET_CLASSES = [
    ("Commodities",            ["DBC", "GLD"]),
    ("Currencies (USD)",       ["UUP"]),
    ("Domestic Equities",      ["SPY", "IWM", "QQQ"]),
    ("Cash",                   ["BIL", "SHV"]),
    ("Fixed Income",           ["AGG", "TLT"]),
    ("International Equities", ["EFA", "EEM"]),
    ("Crypto",                 ["BTC-USD", "ETH-USD"]),
]

# ── Scenario stress tests (§07) ────────────────────────────────────────────────────
# Overrides are RAW readings for factor ids (same units as the factor's calc, before `scale`).
SCENARIOS = [
    dict(name="Recession Onset", dir="RISK-OFF",
         desc="Sahm Rule trips, claims surge, activity contracts, credit widens and breadth breaks.",
         overrides=dict(sahm=0.6, claims=30, unrate=0.6, cfnai=-0.6, indpro=-2, hyoas=6.0, hychg=1.5,
                        sectbreadth=25, spx200=-6, slope200=-1.5, dd52=-14),
         analog="Sep 2007 · Mar 2020"),
    dict(name="Credit Crunch", dir="RISK-OFF",
         desc="HY OAS past 700 bp, IG to 200 bp, MOVE above 160, conditions tighten sharply.",
         overrides=dict(hyoas=7.0, igoas=2.0, hyig=3.5, hychg=3.0, baa10y=3.5, move=165, nfci=0.6,
                        hygief=-6),
         analog="Sep 2008 · Mar 2020 · Aug 2011"),
    dict(name="Geopolitical Shock", dir="RISK-OFF",
         desc="Conflict escalation: VIX spikes into the 30s, oil and gold surge, dollar bid.",
         overrides=dict(vix=34, vixterm=1.15, vixspike=14, move=140, spxgold=-12, dxy=4, audjpy=-8,
                        spx50=-6, dd52=-9),
         analog="Aug 1990 · Sep 2001 · Feb 2022"),
    dict(name="Inflation Re-Acceleration", dir="RISK-OFF",
         desc="Core PCE back above 3%, hawkish Fed surprise, long yields jump.",
         overrides=dict(realffr=2.2, dgs10chg=1.0, t10y2y=-0.5, move=135, iwfiwd=-8, hychg=0.6,
                        netliq=-3),
         analog="H1 2022 · 1994"),
    dict(name="China Hard Landing", dir="RISK-OFF",
         desc="Copper −20%, EM equities slide, USD strengthens sharply.",
         overrides=dict(cugold=-18, dxy=5, audjpy=-10, cfnai=-0.3, indpro=-1, spx50=-4),
         analog="Aug 2015 · Q4 2018"),
    dict(name="Soft Landing Confirmed", dir="RISK-ON",
         desc="Activity re-accelerates, claims stable, breadth broadens out.",
         overrides=dict(cfnai=0.3, indpro=3, permits=12, claims=-5, sectbreadth=85, rspspy=4,
                        nyaspx=3, sphb=6),
         analog="1995 · 2014 · late 2019"),
    dict(name="Fed Pivot · 50bp Surprise", dir="RISK-ON",
         desc="Unexpected 50bp cut, more signalled; real FFR drops and liquidity expands.",
         overrides=dict(realffr=-0.5, nfci=-0.6, t10y2y=1.0, netliq=4, dgs10chg=-0.6, dxy=-3),
         analog="Jul 1995 · Aug 2019"),
]
