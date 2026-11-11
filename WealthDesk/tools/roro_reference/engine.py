"""
Scoring engine: factors → buckets → horizon composites, plus every derived panel on the dashboard.
All numbers are computed from the loaded data; nothing is hard-coded.
"""
from __future__ import annotations

import math
from datetime import datetime

import numpy as np
import pandas as pd

import config as C

BKEYS = [b for b, _ in C.BUCKETS]
BNAMES = dict(C.BUCKETS)
HZ = ["tactical", "intermediate", "strategic"]


# ── Primitives ─────────────────────────────────────────────────────────────────
def pw(x, pts):
    xs, ys = zip(*pts)
    if isinstance(x, pd.Series):
        v = x.values.astype(float)
        out = np.interp(v, xs, ys)
        out[np.isnan(v)] = np.nan
        return pd.Series(out, index=x.index)
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return np.nan
    return float(np.interp(x, xs, ys))


def wavg(frame: pd.DataFrame, weights: dict) -> pd.Series:
    w = pd.Series({k: weights.get(k, 0) for k in frame.columns}, dtype=float)
    mask = frame.notna()
    num = (frame.fillna(0) * w).sum(axis=1)
    den = (mask * w).sum(axis=1)
    return (num / den).where(den > 0)


def band(v, off=C.OFFENSE_LINE, de=C.DEFENSE_LINE):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return "OFFENSE" if v > off else ("DEFENSE" if v < de else "NEUTRAL")


def regime(v):
    if v >= 60: return "Risk-On Aggressive"
    if v >= 20: return "Risk-On Constructive"
    if v > -20: return "Neutral"
    if v > -60: return "Risk-Off Defensive"
    return "Crisis"


def sig(score):
    if score is None or math.isnan(score): return "N/A"
    return "ON" if score >= C.SIGNAL_ON else ("OFF" if score <= C.SIGNAL_OFF else "NEU")


def r1(x, d=1):
    if x is None: return None
    try:
        if math.isnan(x) or math.isinf(x): return None
    except TypeError:
        return x
    return round(float(x), d)


def fmt_reading(f, v):
    if v is None or math.isnan(v): return "—"
    return f["fmt"].format(v * f.get("scale", 1)).replace("-", "−")


def trailing_true(s: pd.Series) -> int:
    n = 0
    for v in reversed(s.fillna(False).values):
        if not v: break
        n += 1
    return n


# ── Core model ─────────────────────────────────────────────────────────────────
def compute_core(D):
    raw, scores = {}, {}
    for f in C.FACTORS:
        try:
            s = f["calc"](D)
        except Exception:  # noqa: BLE001
            s = None
        if s is None or s.dropna().empty:
            raw[f["id"]] = None
            continue
        s = s.replace([np.inf, -np.inf], np.nan)
        raw[f["id"]] = s
        scores[f["id"]] = pw(s, f["map"])
    S = pd.DataFrame(scores)
    buckets = {}
    for b in BKEYS:
        ids = [f["id"] for f in C.FACTORS if f["bucket"] == b and f["id"] in S]
        if ids:
            buckets[b] = wavg(S[ids], {f["id"]: f["weight"] for f in C.FACTORS})
    B = pd.DataFrame(buckets)
    comp_raw, comp = {}, {}
    for h in HZ:
        c = wavg(B, C.HORIZON_WEIGHTS[h]).where(B.notna().sum(axis=1) >= 4)
        comp_raw[h] = c
        span = C.HORIZON_SMOOTHING[h]
        comp[h] = c.ewm(span=span, min_periods=1).mean().where(c.notna()) if span > 1 else c
    return raw, S, B, pd.DataFrame(comp), pd.DataFrame(comp_raw)


def composites_from_scores(score_row: dict) -> tuple[dict, dict]:
    """Bucket + horizon composites for one day's factor scores (used by scenarios)."""
    bk = {}
    for b in BKEYS:
        items = [(f["weight"], score_row[f["id"]]) for f in C.FACTORS
                 if f["bucket"] == b and f["id"] in score_row and not math.isnan(score_row[f["id"]])]
        if items:
            bk[b] = sum(w * s for w, s in items) / sum(w for w, _ in items)
    hz = {}
    for h in HZ:
        w = C.HORIZON_WEIGHTS[h]
        den = sum(w[b] for b in bk)
        hz[h] = sum(w[b] * bk[b] for b in bk) / den if den else float("nan")
    return bk, hz


# ── Panels ─────────────────────────────────────────────────────────────────────
PLAIN = [
    (40, "Conditions are clearly supportive. Lean into risk."),
    (20, "Constructive backdrop. Modest overweight is reasonable."),
    (5, "Mixed and slightly positive. Stay benchmark-weight."),
    (-5, "Balanced — no edge either way. Stay benchmark-weight."),
    (-20, "Mixed and slightly negative. Stay benchmark-weight, tighten risk."),
    (-60, "Deteriorating. Reduce risk and favour defensives."),
    (-999, "Crisis conditions — historically a contrarian zone, but protect capital first."),
]


def plain_english(v):
    for th, txt in PLAIN:
        if v >= th:
            return txt
    return PLAIN[-1][1]


def horizon_panel(comp, B, h):
    s = comp[h].dropna()
    v = s.iloc[-1]
    w = C.HORIZON_WEIGHTS[h]
    cur = B.iloc[-1].dropna()
    contrib = {b: w[b] * cur[b] / 100 for b in cur.index}
    top = max(contrib, key=lambda b: contrib[b]) if contrib else None
    low = min(contrib, key=lambda b: contrib[b]) if contrib else None
    return dict(
        key=h, **C.HORIZON_META[h], value=r1(v, 0),
        wow=r1(v - s.iloc[-6], 0) if len(s) > 6 else None,
        avg4w=r1(s.iloc[-20:].mean(), 0),
        band=band(v), regime=regime(v), plain=plain_english(v),
        top=dict(bucket=BNAMES.get(top), score=r1(cur.get(top), 0)) if top else None,
        low=dict(bucket=BNAMES.get(low), score=r1(cur.get(low), 0)) if low else None,
        weights={b: w[b] for b in BKEYS},
    )


def buckets_panel(B, S):
    cur, wk = B.iloc[-1], B.iloc[-6] if len(B) > 6 else B.iloc[-1]
    out = []
    for b in BKEYS:
        n_live = sum(1 for f in C.FACTORS if f["bucket"] == b and f["id"] in S and not math.isnan(S[f["id"]].iloc[-1]))
        n_all = sum(1 for f in C.FACTORS if f["bucket"] == b)
        out.append(dict(key=b, name=BNAMES[b], score=r1(cur.get(b), 0),
                        wow=r1(cur.get(b) - wk.get(b), 0) if b in B else None,
                        factors_live=n_live, factors_total=n_all,
                        spark=[r1(x, 0) for x in B[b].iloc[-260::5].tolist()] if b in B else []))
    return out


def factor_table(D, raw, S):
    rows = []
    for b in BKEYS:
        fs = [f for f in C.FACTORS if f["bucket"] == b]
        live = [f for f in fs if f["id"] in S and not math.isnan(S[f["id"]].iloc[-1])]
        wsum = sum(f["weight"] for f in live) or 1
        for f in fs:
            s = raw.get(f["id"])
            val = s.iloc[-1] if s is not None else float("nan")
            sc = S[f["id"]].iloc[-1] if f["id"] in S else float("nan")
            wt = f["weight"] / wsum * 100 if f in live else 0
            spark = [] if s is None else [r1(x * f.get("scale", 1), 3) for x in s.iloc[-252::5].tolist()]
            rows.append(dict(id=f["id"], name=f["name"], bucket=b, reading=fmt_reading(f, val),
                             score=r1(sc, 0), weight=r1(wt, 0), contrib=r1(wt * sc / 100 if not math.isnan(sc) else float("nan"), 1),
                             signal=sig(sc), src=f["src"], spark=spark,
                             wow=r1(sc - S[f["id"]].iloc[-6], 0) if f["id"] in S and len(S) > 6 else None))
    return rows


def flags_panel(D, raw, S, B, comp):
    flags = []

    def add(kind, title, cond: pd.Series, text):
        if cond is None or cond.dropna().empty:
            return
        n = trailing_true(cond)
        if n:
            flags.append(dict(kind=kind, title=title, text=text, sessions=n))

    g = lambda k: raw.get(k)
    spread = (comp["tactical"] - comp["strategic"]).abs()
    t, st = comp["tactical"].iloc[-1], comp["strategic"].iloc[-1]
    add("WARN", "Cross-horizon divergence", spread > 30,
        f"Tactical ({t:+.0f}) vs Strategic ({st:+.0f}): a {abs(t - st):.0f}-pt spread, past the 30-pt threshold. "
        "Fast and slow signals disagree; these usually resolve by the fast dial reverting toward the slow one.")
    disp = B.max(axis=1) - B.min(axis=1)
    hi, lo = B.iloc[-1].idxmax(), B.iloc[-1].idxmin()
    add("WARN", "Bucket disagreement", disp > 80,
        f"{BNAMES[hi]} ({B.iloc[-1][hi]:+.0f}) vs {BNAMES[lo]} ({B.iloc[-1][lo]:+.0f}). "
        "When buckets this far apart, the composite is an average of opposing calls — size positions down.")
    if "CREDIT" in B and "MACRO" in B:
        add("OPP", "Credit not pricing macro risk", (B["CREDIT"] > 30) & (B["MACRO"] < -10),
            f"Credit bucket {B['CREDIT'].iloc[-1]:+.0f} while Macro is {B['MACRO'].iloc[-1]:+.0f}. "
            "Either credit is right (no recession) or this is pre-stress complacency. Watch HY OAS for the first widening.")
    if g("dd52") is not None and g("sectbreadth") is not None:
        add("WARN", "Narrow leadership", (g("dd52") > -3) & (g("sectbreadth") < 50),
            f"SPX within 3% of its 52-week high but only {g('sectbreadth').iloc[-1]:.0f}% of sector ETFs are above their 200-DMA.")
    if g("vix") is not None and g("skew") is not None:
        add("WARN", "Vol complacency", (g("vix") < 14) & (g("skew") > 145),
            f"VIX {g('vix').iloc[-1]:.1f} with SKEW {g('skew').iloc[-1]:.0f}: calm surface, tail hedges bid.")
    if g("vix") is not None:
        add("OPP", "VIX in add-to-risk zone", g("vix") > 27.3,
            f"VIX {g('vix').iloc[-1]:.1f} is above its long-run mean + 1σ. See the playbook for historical forward returns.")
    if g("dgs10chg") is not None:
        add("RISK", "Rates shock", g("dgs10chg") > 0.6,
            f"10y yield up {g('dgs10chg').iloc[-1]:+.2f} pp over 3 months — fast enough to pressure multiples.")
    if g("netliq") is not None:
        add("RISK", "Liquidity drain", g("netliq") < -3,
            f"Net Fed liquidity down {g('netliq').iloc[-1]:.1f}% over 13 weeks.")
    if g("sahm") is not None:
        add("RISK", "Sahm Rule rising", g("sahm") >= 0.3,
            f"Real-time Sahm reading {g('sahm').iloc[-1]:.2f}; the recession trigger is 0.50.")
    if g("t10y3m") is not None:
        c = g("t10y3m")
        was_inv = (c < 0).rolling(504, min_periods=1).max().astype(bool)
        add("RISK", "Yield curve un-inverting", (c > 0) & was_inv & (c.rolling(126, min_periods=1).min() < 0),
            f"3m10y back to {c.iloc[-1]:+.2f}% after an inversion. Historically the un-inversion, not the inversion, sat closest to recessions.")
    if g("spx50") is not None:
        add("WARN", "Short-term momentum break", g("spx50") < -5,
            f"SPX {g('spx50').iloc[-1]:+.1f}% below its 50-DMA.")
    if g("hychg") is not None:
        add("RISK", "Credit spreads widening", g("hychg") > 0.75,
            f"HY OAS up {g('hychg').iloc[-1] * 100:+.0f} bp in 3 months.")
    order = {"RISK": 0, "WARN": 1, "OPP": 2}
    return sorted(flags, key=lambda f: (order[f["kind"]], -f["sessions"]))


def vix_panel(D):
    vix, spx = D.yf_raw("^VIX"), D.yf_raw("^GSPC")
    if vix is None or spx is None:
        return None
    m, sd = vix.mean(), vix.std()
    fwd = (spx.shift(-252) / spx - 1) * 100
    df = pd.concat([vix.rename("v"), fwd.rename("f")], axis=1).dropna()
    levels = []
    names = ["1ST", "2ND", "3RD", ">4σ"]
    for k in range(4):
        lo, hi = m + (k + 1) * sd, (m + (k + 2) * sd if k < 3 else 1e9)
        sel = df[(df.v >= lo) & (df.v < hi)]
        levels.append(dict(name=names[k], lo=r1(lo), hi=r1(hi) if k < 3 else None,
                           ret=r1(sel.f.mean()) if len(sel) >= 10 else None,
                           win=r1((sel.f > 0).mean() * 100, 0) if len(sel) >= 10 else None, n=len(sel)))
    base = df[df.v < m + sd]
    cur = float(vix.iloc[-1])
    term = None
    v3 = D.yf_raw("^VIX3M")
    if v3 is not None:
        term = r1(cur / float(v3.iloc[-1]), 2)
    zone = "BELOW MEAN · CALM" if cur < m else ("ABOVE MEAN · WATCHING" if cur < m + sd else "ADD-TO-RISK ZONE")
    sk, mv = D.yf_raw("^SKEW"), D.yf_raw("^MOVE")
    return dict(current=r1(cur), mean=r1(m), sd=r1(sd), zone=zone, levels=levels,
                base=dict(ret=r1(base.f.mean()), win=r1((base.f > 0).mean() * 100, 0)),
                since=vix.index[0].year, term=term,
                skew=r1(float(sk.iloc[-1]), 0) if sk is not None else None,
                move=r1(float(mv.iloc[-1]), 0) if mv is not None else None,
                ticks=[r1(x) for x in [5, m, m + sd, m + 2 * sd, m + 3 * sd, m + 4 * sd, 60]])


def leadership_panel(D):
    rows, hist = [], {}
    for name, ts in C.ASSET_CLASSES:
        series = [D.yf(t) for t in ts if D.yf(t) is not None]
        if not series:
            continue
        r13 = pd.concat([(s / s.shift(63) - 1) * 100 for s in series], axis=1).mean(axis=1)
        r4 = pd.concat([(s / s.shift(20) - 1) * 100 for s in series], axis=1).mean(axis=1)
        hist[name] = 0.6 * r13 + 0.4 * r4
        a, b = r13.iloc[-1], r4.iloc[-1]
        trend = "Rising" if b > 1 else ("Falling" if b < -1 else "Steady")
        rows.append(dict(name=name, tickers=" · ".join(ts), r13=r1(a), r4=r1(b), trend=trend,
                         mom=0.6 * a + 0.4 * b))
    rows.sort(key=lambda r: -r["mom"] if not math.isnan(r["mom"]) else 1e9)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
        r.pop("mom")
    H = pd.DataFrame(hist).dropna()
    ranks = H.rank(axis=1, ascending=False).iloc[::-5]   # weekly, newest first
    eq = "Domestic Equities"
    tenure, eq_rank = 0, None
    if eq in ranks:
        eq_rank = int(ranks[eq].iloc[0])
        for v in ranks[eq]:
            if int(v) != eq_rank: break
            tenure += 1
    return dict(rows=rows, eq_rank=eq_rank, eq_tenure_weeks=tenure, total=len(rows),
                riskoff=eq_rank is not None and eq_rank > 2)


def scenarios_panel(raw, S, comp, comp_raw):
    base_row = {k: float(S[k].iloc[-1]) for k in S.columns}
    _, base_hz = composites_from_scores(base_row)
    out = []
    for sc in C.SCENARIOS:
        row = dict(base_row)
        moves = []
        for fid, val in sc["overrides"].items():
            f = next(f for f in C.FACTORS if f["id"] == fid)
            new = pw(val, f["map"])
            if fid in row:
                moves.append((f["name"], new - row[fid]))
            row[fid] = new
        _, hz = composites_from_scores(row)
        horizons = []
        for h in HZ:
            today = float(comp[h].iloc[-1])
            after = round(today + (hz[h] - base_hz[h]))
            horizons.append(dict(key=h, label=C.HORIZON_META[h]["label"], span=C.HORIZON_META[h]["span"],
                                 today=r1(today, 0), after=r1(after, 0), delta=r1(after - today, 0), posture=band(after)))
        moves.sort(key=lambda m: -abs(m[1]))
        out.append(dict(name=sc["name"], dir=sc["dir"], desc=sc["desc"], analog=sc["analog"],
                        horizons=horizons, moves=[dict(name=n, delta=r1(d, 0)) for n, d in moves[:5]]))
    return out


def analogs_panel(D, B, comp, n=5):
    spx = D.yf("^GSPC")
    if spx is None:
        return []
    full = B.dropna()
    if full.empty:
        return []
    now = full.iloc[-1].values
    cutoff = full.index[-1] - pd.Timedelta(days=380)
    cand = full[full.index <= cutoff]
    cand = cand.groupby(cand.index.to_period("M")).tail(1)   # month-ends
    nv = np.linalg.norm(now)
    # Match = 1 − ‖then − now‖ / (‖then‖ + ‖now‖): 1 = identical fingerprint; penalises both
    # direction and magnitude differences (pure cosine can't tell +10 apart from +80).
    sims = cand.apply(lambda r: float(1 - np.linalg.norm(r.values - now) / (np.linalg.norm(r.values) + nv + 1e-9)), axis=1)
    cosines = cand.apply(lambda r: float(np.dot(r.values, now) / (np.linalg.norm(r.values) * nv + 1e-9)), axis=1)
    picks = []
    for d, s in sims.sort_values(ascending=False).items():
        if all(abs((d - p).days) > 270 for p, _ in picks):
            picks.append((d, s))
        if len(picks) == n:
            break
    post = comp["intermediate"].apply(band)
    ret = spx.pct_change(fill_method=None).fillna(0)
    out = []
    for d, s in picks:
        i = spx.index.get_loc(d)
        win = spx.iloc[i:i + 253]
        fwd = lambda k: r1((spx.iloc[i + k] / spx.iloc[i] - 1) * 100) if i + k < len(spx) else None
        maxdd = r1(((win / win.cummax()) - 1).min() * 100)
        # Rule: out of the market (0% cash) while the Intermediate posture is DEFENSE, acting next day.
        pos = (post.shift(1).iloc[i + 1:i + 253] != "DEFENSE").astype(float)
        r = ret.iloc[i + 1:i + 253]
        strat = r1((np.prod(1 + pos.values * r.values) - 1) * 100)
        bh = r1((np.prod(1 + r.values) - 1) * 100)
        eq = np.cumprod(1 + pos.values * r.values)
        sdd = r1((eq / np.maximum.accumulate(eq) - 1).min() * 100)
        p = post.iloc[i:i + 253]
        off_dates = p.index[(p == "DEFENSE") & (p.shift(1) != "DEFENSE")]
        on_dates = p.index[(p != "DEFENSE") & (p.shift(1) == "DEFENSE")]
        start_def = p.iloc[0] == "DEFENSE"
        first_off = p.index[0] if start_def else (off_dates[0] if len(off_dates) else None)
        back_on = next((x for x in on_dates if first_off is not None and x > first_off), None)
        low_date = win.idxmin()
        net = None if strat is None or bh is None else r1(strat - bh)
        verdict = "NO SIGNAL FIRED" if first_off is None else (
            "SIGNAL WOULD HAVE HELPED" if net > 1 else ("SIGNAL WOULD HAVE HURT" if net < -1 else "ROUGHLY EVEN"))
        then_b = full.loc[d]
        out.append(dict(
            date=d.strftime("%b %Y"), iso=d.strftime("%Y-%m-%d"), sim=r1(s * 100, 0), cos=r1(cosines[d] * 100, 0),
            then={b: r1(then_b[b], 0) for b in full.columns}, now={b: r1(full.iloc[-1][b], 0) for b in full.columns},
            comp_then=r1(comp["intermediate"].loc[d], 0),
            fwd3=fwd(63), fwd6=fwd(126), fwd12=fwd(252), maxdd=maxdd,
            strat=strat, bh=bh, strat_dd=sdd, net=net, verdict=verdict,
            switches=int((pos.diff().abs() > 0).sum()),
            off=first_off.strftime("%b %d, %Y") if first_off is not None else None,
            on=back_on.strftime("%b %d, %Y") if back_on is not None else None,
            low=low_date.strftime("%b %d, %Y"),
            days_out=int((pos == 0).sum()), start_def=bool(start_def),
        ))
    return out


def history_panel(comp, months=24):
    start = comp.index[-1] - pd.DateOffset(months=months)
    h = comp[comp.index >= start]
    return dict(dates=[d.strftime("%Y-%m-%d") for d in h.index],
                **{k: [r1(x, 1) for x in h[k].tolist()] for k in HZ})


def posture_panel(comp, last_run):
    s = comp["intermediate"].dropna()
    v = float(round(s.iloc[-1]))
    b = band(v)
    bands = s.round().apply(band)
    chg = bands[bands != bands.shift(1)]
    since = chg.index[-1]
    if last_run:
        prev_v, prev_date = last_run["intermediate"], last_run["date"]
    else:
        prev_v, prev_date = float(s.iloc[-6]), s.index[-6].strftime("%Y-%m-%d")
    lean = ""
    if b == "NEUTRAL":
        lean = "LEANING OFFENSE" if v > 5 else ("LEANING DEFENSE" if v < -5 else "BALANCED")
    t = float(comp["tactical"].iloc[-1])
    tac_agree = (t > 5 and v > 5) or (t < -5 and v < -5) or (abs(t) <= 5 and abs(v) <= 5)
    near = "Offense" if abs(C.OFFENSE_LINE - v) < abs(v - C.DEFENSE_LINE) else "Defense"
    flip = band(prev_v) != b
    approaching = (b == "NEUTRAL") and min(abs(C.OFFENSE_LINE - v), abs(v - C.DEFENSE_LINE)) <= 5
    status = "FLIPPED" if flip else ("WATCH" if approaching else "NO CHANGE")
    if b == "OFFENSE":
        play = "Press offense. Hold or add to equity exposure and let winners run; use pullbacks to add. Stay with it until the Intermediate dial closes back below +20."
        direction = "Stay long — defend below +20"
    elif b == "DEFENSE":
        play = "Protect capital. Trim equity toward underweight, raise cash and quality, keep duration. Wait for the Intermediate dial to close back above −20 before re-risking."
        direction = "Stay defensive — re-risk above −20"
    else:
        play = "Decision zone — stay balanced. Hold benchmark weight and avoid big bets; this is where the next regime is decided. Let the Intermediate dial lead, not the headlines."
        direction = "Hold — ready to add above +20" if v >= 0 else "Hold — ready to cut below −20"
    return dict(value=r1(v, 0), band=b, lean=lean, direction=direction, play=play,
                since=since.strftime("%Y-%m-%d"), days_in=int((s.index > since).sum()) + 1,
                prev=r1(prev_v, 0), prev_date=prev_date, delta=r1(v - prev_v, 0),
                to_off=r1(C.OFFENSE_LINE - v, 0), to_def=r1(v - C.DEFENSE_LINE, 0),
                nearest=near, status=status, tac=r1(t, 0), tac_agree=tac_agree,
                strat=r1(float(comp["strategic"].iloc[-1]), 0))


TILTS = {
    "Risk-On Aggressive": [("↑", "EQUITIES", "Overweight · upper band"), ("↑", "CYCLICALS", "Tilt to high beta / cyclicals"),
                           ("↓", "DURATION", "Short duration"), ("↓", "CASH", "Minimal")],
    "Risk-On Constructive": [("↑", "EQUITIES", "Modest OW · neutral-to-upper band"), ("↑", "QUALITY", "Tilt to high-quality, profitable"),
                             ("─", "CREDIT (IG)", "Hold investment grade"), ("─", "DURATION", "Neutral"), ("─", "CASH", "Modest, dry powder")],
    "Neutral": [("─", "EQUITIES", "Benchmark weight"), ("↑", "QUALITY", "Tilt to quality and low leverage"),
                ("─", "CREDIT (IG)", "Hold investment grade"), ("─", "DURATION", "Neutral"), ("─", "CASH", "Modest, dry powder")],
    "Risk-Off Defensive": [("↓", "EQUITIES", "Underweight · lower band"), ("↑", "DEFENSIVES", "Staples, utilities, health care"),
                           ("↑", "DURATION", "Extend duration"), ("↓", "CREDIT (HY)", "Avoid high yield"), ("↑", "CASH", "Raise cash")],
    "Crisis": [("↓", "EQUITIES", "Minimum weight; scale back in on capitulation"), ("↑", "TREASURIES", "Long duration"),
               ("↑", "CASH", "High"), ("↓", "CREDIT", "Avoid spread risk")],
}


def master_panel(comp, B, leadership):
    v = float(comp["intermediate"].iloc[-1])
    t, s = float(comp["tactical"].iloc[-1]), float(comp["strategic"].iloc[-1])
    rg = regime(v)
    same_sign = (t > 0) == (v > 0) == (s > 0)
    disp = float(B.iloc[-1].max() - B.iloc[-1].min())
    if same_sign and abs(t - s) < 20 and disp < 80:
        conf = "HIGH · ALIGNED"
    elif same_sign or abs(t - s) < 30:
        conf = "MEDIUM · MIXED"
    else:
        conf = "LOW · DIVERGENT"
    head = {"Risk-On Aggressive": "ADD RISK", "Risk-On Constructive": "ADD RISK · CAUTIOUSLY",
            "Neutral": "HOLD · BENCHMARK", "Risk-Off Defensive": "REDUCE RISK", "Crisis": "PROTECT CAPITAL"}[rg]
    notes = []
    if t - s > 30: notes.append("fast signals are running well ahead of the slow ones — take profits in extended longs and avoid adding to crowded names")
    if s - t > 30: notes.append("the slow backdrop is better than the tape — dips are more likely buyable than the start of something worse")
    if "MACRO" in B and B["MACRO"].iloc[-1] < -20: notes.append("macro is the weak link; watch claims and the Sahm Rule")
    if "CREDIT" in B and B["CREDIT"].iloc[-1] < -20: notes.append("credit is under stress — respect it, it tends to lead equities")
    base = {
        "Risk-On Aggressive": "Run an overweight in equities with a cyclical tilt.",
        "Risk-On Constructive": "Maintain or modestly increase equity exposure. Tilt toward quality.",
        "Neutral": "Hold benchmark weights and wait for the Intermediate dial to break out of the ±20 band.",
        "Risk-Off Defensive": "Trim equities toward underweight, add duration and defensives.",
        "Crisis": "Defensive positioning; begin a staged plan to re-risk as credit and breadth stabilise.",
    }[rg]
    action = base + (" Note: " + "; ".join(notes) + "." if notes else "")
    rows = leadership["rows"]
    return dict(value=r1(v, 0), regime=rg, head=head, confidence=conf, action=action,
                tilts=[dict(arrow=a, name=n, text=x) for a, n, x in TILTS[rg]],
                favored=[dict(name=r["name"], rank=r["rank"]) for r in rows[:3]],
                under=[dict(name=r["name"], rank=r["rank"]) for r in rows[-2:]])


# ── Build everything ───────────────────────────────────────────────────────────
def build(D, last_run=None):
    raw, S, B, comp, comp_raw = compute_core(D)
    # trim to the last date where the intermediate composite exists
    last = comp["intermediate"].last_valid_index()
    raw = {k: (v.loc[:last] if v is not None else None) for k, v in raw.items()}
    S, B, comp, comp_raw = S.loc[:last], B.loc[:last], comp.loc[:last], comp_raw.loc[:last]
    leadership = leadership_panel(D)
    stale = [h for h in D.health if h["status"] not in ("ok", "synthetic")]
    return dict(
        generated=datetime.now().strftime("%b %d, %Y · %H:%M"),
        asof=last.strftime("%b %d, %Y"), asof_iso=last.strftime("%Y-%m-%d"),
        demo=D.demo,
        n_factors=len(C.FACTORS), n_live=sum(1 for f in C.FACTORS if f["id"] in S and not math.isnan(S[f["id"]].iloc[-1])),
        lines=dict(off=C.OFFENSE_LINE, de=C.DEFENSE_LINE, crisis=C.CRISIS_LINE),
        posture=posture_panel(comp, last_run),
        master=master_panel(comp, B, leadership),
        horizons=[horizon_panel(comp, B, h) for h in HZ],
        buckets=buckets_panel(B, S),
        history=history_panel(comp),
        flags=flags_panel(D, raw, S, B, comp),
        vix=vix_panel(D),
        breadth=r1(raw["sectbreadth"].iloc[-1], 0) if raw.get("sectbreadth") is not None else None,
        leadership=leadership,
        factors=factor_table(D, raw, S),
        scenarios=scenarios_panel(raw, S, comp, comp_raw),
        analogs=analogs_panel(D, B, comp),
        health=D.health, stale=stale,
        weights=C.HORIZON_WEIGHTS, bucket_names=BNAMES,
    )
