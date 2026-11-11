#!/usr/bin/env python3
"""Generates Resources/catalog.json for Wealth Desk.

Every calculator is defined here once. The expected value for every output is
computed by the reference implementation in this file, which is written
independently of the Swift engine. The Swift self-test (`swift run wdcheck`)
must reproduce every expected value, so the two implementations check each
other.

Run:  python3 -I tools/build_catalog.py
"""
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TAXDATA = json.load(open(os.path.join(ROOT, "Resources", "taxdata.json")))
# Expected values are computed with the reference year; the self-test selects the same year.
TAX = next(t for t in TAXDATA["tables"] if t["taxYear"] == TAXDATA["referenceYear"])

# ---------------------------------------------------------------------------
# Reference math (independent of the Swift engine)
# ---------------------------------------------------------------------------


class Series(list):
    def _op(self, other, f):
        if isinstance(other, list):
            if len(other) != len(self):
                raise ValueError("series length mismatch")
            return Series(f(a, b) for a, b in zip(self, other))
        return Series(f(a, other) for a in self)

    def _rop(self, other, f):
        return Series(f(other, a) for a in self)

    __add__ = lambda s, o: s._op(o, lambda a, b: a + b)
    __radd__ = lambda s, o: s._rop(o, lambda a, b: a + b)
    __sub__ = lambda s, o: s._op(o, lambda a, b: a - b)
    __rsub__ = lambda s, o: s._rop(o, lambda a, b: a - b)
    __mul__ = lambda s, o: s._op(o, lambda a, b: a * b)
    __rmul__ = lambda s, o: s._rop(o, lambda a, b: a * b)
    __truediv__ = lambda s, o: s._op(o, lambda a, b: a / b)
    __rtruediv__ = lambda s, o: s._rop(o, lambda a, b: a / b)
    __pow__ = lambda s, o: s._op(o, lambda a, b: a ** b)
    __neg__ = lambda s: Series(-a for a in s)


def fv(r, n, pmt, pv):
    if r == 0:
        return pv + pmt * n
    g1 = math.expm1(n * math.log1p(r))        # (1+r)^n - 1 without cancellation for tiny r
    return pv * (1 + g1) + pmt * g1 / r


def pv(r, n, pmt):
    if r == 0:
        return pmt * n
    return pmt * -math.expm1(-n * math.log1p(r)) / r


def pmt(r, n, pv_):
    if r == 0:
        return pv_ / n
    return pv_ * r / -math.expm1(-n * math.log1p(r))


def nper(r, pmt_, pv_, fv_):
    if r == 0:
        return (fv_ - pv_) / pmt_
    return math.log((fv_ * r + pmt_) / (pv_ * r + pmt_)) / math.log(1 + r)


def npv(r, cf):
    return sum(c / (1 + r) ** t for t, c in enumerate(cf))


def sign_changes(cf):
    signs = [c > 0 for c in cf if c != 0]
    return sum(1 for a, b in zip(signs, signs[1:]) if a != b)


def irr(cf):
    if len(cf) < 2 or sign_changes(cf) != 1:
        raise ValueError("IRR needs exactly one sign change")
    lo, hi = -0.9999, 10.0
    flo = npv(lo, cf)
    if (flo > 0) == (npv(hi, cf) > 0):
        raise ValueError("IRR outside the solvable range")
    for _ in range(300):
        mid = (lo + hi) / 2
        fm = npv(mid, cf)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2


def brackets(status):
    return TAX["ordinaryBrackets"][str(int(status))]


def incometax(ti, status):
    ti = max(0.0, ti)
    b = brackets(status)
    tax = 0.0
    for i, (floor, rate) in enumerate(b):
        top = b[i + 1][0] if i + 1 < len(b) else float("inf")
        if ti > floor:
            tax += (min(ti, top) - floor) * rate
    return tax


def margrate(ti, status):
    rate = brackets(status)[0][1]
    for floor, r in brackets(status):
        if ti >= floor:
            rate = r
    return rate


def bracketroom(ti, status):
    b = brackets(status)
    for i, (floor, _) in enumerate(b):
        top = b[i + 1][0] if i + 1 < len(b) else None
        if top is None:
            return float("nan")
        if ti < top:
            return top - max(ti, 0)
    return float("nan")


def stddeduction(status):
    return TAX["standardDeduction"][str(int(status))]


def ltcgtax(ordinary, gain, status):
    t0, t15 = TAX["ltcgThresholds"][str(int(status))]
    total = ordinary + gain
    in0 = max(0.0, min(total, t0) - ordinary)
    in15 = max(0.0, min(total, t15) - max(ordinary, t0))
    in20 = max(0.0, gain - in0 - in15)
    return 0.15 * in15 + 0.20 * in20


def niitthreshold(status):
    return TAX["niitThreshold"][str(int(status))]


def rmdfactor(age):
    return TAX["uniformLifetime"][str(int(age))]


def limit401k(age):
    L = TAX["limits"]
    extra = 0
    if 60 <= age <= 63:
        extra = L["catchUp401k60to63"]
    elif age >= 50:
        extra = L["catchUp401k50"]
    return L["deferral401k"] + extra


def limitira(age):
    L = TAX["limits"]
    return L["ira"] + (L["iraCatchUp50"] if age >= 50 else 0)


def rate(n, pmt_, pv_):
    """Periodic rate at which pv(rate, n, pmt) equals pv_ (bisection)."""
    lo, hi = -0.99, 10.0

    def value(r):
        # IEEE semantics like the app: overflow becomes ±infinity instead of an exception.
        try:
            return pv(r, n, pmt_) if r != 0 else pmt_ * n
        except OverflowError:
            return math.copysign(float("inf"), pmt_)

    if (value(lo) > pv_) == (value(hi) > pv_):
        raise ValueError("rate outside the solvable range")
    for _ in range(400):
        mid = (lo + hi) / 2
        if value(mid) > pv_:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _periods(years, freq):
    return int(math.floor(years * freq + 0.5))


def bondprice(face, cpn, ytm, years, freq):
    n = _periods(years, freq)
    i = ytm / freq
    c = face * cpn / freq
    if i == 0:
        return c * n + face
    return c * (1 - (1 + i) ** (-n)) / i + face * (1 + i) ** (-n)


def bondytm(price, face, cpn, years, freq):
    lo, hi = -0.5, 1.0
    if (bondprice(face, cpn, lo, years, freq) > price) == (bondprice(face, cpn, hi, years, freq) > price):
        raise ValueError("yield outside the solvable range")
    for _ in range(300):
        mid = (lo + hi) / 2
        if bondprice(face, cpn, mid, years, freq) > price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def macdur(face, cpn, ytm, years, freq):
    n = _periods(years, freq)
    i = ytm / freq
    c = face * cpn / freq
    total = 0.0
    for k in range(1, n + 1):
        cf = c + (face if k == n else 0.0)
        total += (k / freq) * cf / (1 + i) ** k
    return total / bondprice(face, cpn, ytm, years, freq)


def bondconvexity(face, cpn, ytm, years, freq):
    n = _periods(years, freq)
    i = ytm / freq
    c = face * cpn / freq
    total = 0.0
    for k in range(1, n + 1):
        cf = c + (face if k == n else 0.0)
        total += cf * k * (k + 1) / (1 + i) ** (k + 2)
    return total / (bondprice(face, cpn, ytm, years, freq) * freq * freq)


# --- statistics -------------------------------------------------------------

def median(s):
    v = sorted(s)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def var(s):
    m = sum(s) / len(s)
    return sum((x - m) ** 2 for x in s) / (len(s) - 1)


def sd(s):
    return math.sqrt(var(s))


def cov(a, b):
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (len(a) - 1)


def corr(a, b):
    return cov(a, b) / (sd(a) * sd(b))


def dw(e):
    return sum((e[i] - e[i - 1]) ** 2 for i in range(1, len(e))) / sum(x * x for x in e)


def normcdf(z):
    return 0.5 * math.erfc(-z / math.sqrt(2.0))


def norminv(p):
    lo, hi = -40.0, 40.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if normcdf(mid) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _betacf(a, b, x):
    FPMIN = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < FPMIN:
        d = FPMIN
    d = 1.0 / d
    h = d
    for m in range(1, 301):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        de = d * c
        h *= de
        if abs(de - 1.0) < 3e-16:
            break
    return h


def betai(a, b, x):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    bt = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1.0 - x))
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def tcdf(t, df):
    x = df / (df + t * t)
    p = 0.5 * betai(df / 2.0, 0.5, x)
    return 1.0 - p if t > 0 else p


def tinv(p, df):
    lo, hi = -1000.0, 1000.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if tcdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def fcdf(f, d1, d2):
    if f <= 0:
        return 0.0
    return betai(d1 / 2.0, d2 / 2.0, d1 * f / (d1 * f + d2))


def binompmf(n, k, p):
    n, k = int(n), int(k)
    if k < 0 or k > n:
        return 0.0
    if p == 0:
        return 1.0 if k == 0 else 0.0
    if p == 1:
        return 1.0 if k == n else 0.0
    return math.exp(math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)
                    + k * math.log(p) + (n - k) * math.log(1 - p))


def binomcdf(n, k, p):
    total = 0.0
    for i in range(0, int(k) + 1):
        total += binompmf(n, i, p)
    return min(1.0, total)


def iff(c, a, b):
    return a if c else b


FUNCS = {
    "fv": fv, "pv": pv, "rate": rate, "pmt": pmt, "nper": nper, "npv": npv, "irr": irr,
    "incometax": incometax, "margrate": margrate, "bracketroom": bracketroom,
    "stddeduction": stddeduction, "ltcgtax": ltcgtax, "niitthreshold": niitthreshold,
    "rmdfactor": rmdfactor, "limit401k": limit401k, "limitira": limitira,
    "giftexclusion": lambda: TAX["giftAnnualExclusion"],
    "estateexemption": lambda: TAX["estateExemption"],
    "estaterate": lambda: TAX["estateTopRate"],
    "niitrate": lambda: TAX["niitRate"],
    "min": min, "max": max, "abs": abs, "sqrt": math.sqrt, "ln": math.log,
    "exp": math.exp, "floor": math.floor, "ceil": math.ceil,
    "sum": lambda s: float(sum(s)), "count": lambda s: float(len(s)),
    "avg": lambda s: float(sum(s)) / len(s),
    "sumproduct": lambda a, b: float(sum(x * y for x, y in zip(a, b))),
    "bondprice": bondprice, "bondytm": bondytm, "macdur": macdur, "bondconvexity": bondconvexity,
    "nan": lambda: float("nan"),
    "median": median, "var": var, "sd": sd, "cov": cov, "corr": corr, "dw": dw,
    "normcdf": normcdf, "norminv": norminv, "tcdf": tcdf, "tinv": tinv, "fcdf": fcdf,
    "binompmf": binompmf, "binomcdf": binomcdf, "pi": lambda: math.pi,
    "topsum": lambda s_, k: float(sum(sorted(s_, reverse=True)[:int(k)])),
    "iff": iff,
}


def lazy_if(expr):
    """Rewrites if(c, a, b) as a Python conditional so only the chosen branch is evaluated (as in the app)."""
    out, i = "", 0
    while True:
        m = re.search(r"\bif\(", expr[i:])
        if not m:
            return out + expr[i:]
        start = i + m.start()
        out += expr[i:start]
        j, depth, args, cur = start + 3, 1, [], ""
        while depth:
            ch = expr[j]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    break
            if ch == "," and depth == 1:
                args.append(cur); cur = ""
            else:
                cur += ch
            j += 1
        args.append(cur)
        c, a, b = (lazy_if(x) for x in args)
        out += f"(({a}) if ({c}) else ({b}))"
        i = j + 1


def ref_eval(expr, scope):
    py = lazy_if(expr).replace("^", "**")
    env = dict(FUNCS)
    env.update(scope)
    return eval(py, {"__builtins__": {}}, env)  # trusted, local definitions only


# --- projections -----------------------------------------------------------

def proj_retirement(v):
    a0, ar, ae = int(v["age"]), int(v["retire"]), int(v["plan"])
    bal = v["bal"]
    rows = []
    retire_bal = bal if ar <= a0 else None
    depletion = -1.0
    total_w = 0.0
    first_w = 0.0
    for age in range(a0, ae):
        t = age - a0
        if age == ar:
            retire_bal = bal
        start = bal
        contrib = v["c"] * (1 + v["cg"]) ** t if age < ar else 0.0
        need = v["spend"] * (1 + v["infl"]) ** t if age >= ar else 0.0
        other = v["other"] * (1 + v["infl"]) ** t if (age >= ar and age >= v["oage"]) else 0.0
        w = max(0.0, need - other)
        if w > start + contrib:
            w = start + contrib
            if depletion < 0:
                depletion = float(age)
        if age == ar:
            first_w = w
        r = v["rpre"] if age < ar else v["rpost"]
        base = start + contrib - w
        end = base * (1 + r)
        total_w += w
        rows.append([age, start, contrib, w, end - base, end])
        bal = end
    if retire_bal is None:
        retire_bal = bal
    return {
        "p_retire_balance": retire_bal,
        "p_end_balance": bal,
        "p_depletion_age": depletion,
        "p_first_withdrawal": first_w,
        "p_total_withdrawn": total_w,
    }, rows


MASK = (1 << 64) - 1


class SplitMix:
    def __init__(self, seed):
        self.s = seed & MASK

    def next(self):
        self.s = (self.s + 0x9E3779B97F4A7C15) & MASK
        z = self.s
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK
        return z ^ (z >> 31)

    def uniform(self):
        return (self.next() >> 11) * (1.0 / 9007199254740992.0)

    def normal(self):
        u1 = max(self.uniform(), 1e-300)
        u2 = self.uniform()
        return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def percentile(sorted_vals, p):
    n = len(sorted_vals)
    idx = p * (n - 1)
    lo = int(math.floor(idx))
    hi = min(lo + 1, n - 1)
    frac = idx - lo
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac


def proj_montecarlo(v):
    sims, years = int(v["sims"]), int(v["years"])
    rng = SplitMix(int(v["seed"]))
    paths = []
    ok = 0
    for _ in range(sims):
        bal, w = v["bal"], v["w"]
        path = []
        failed = False
        for _y in range(years):
            z = rng.normal()
            if not failed:
                if bal < w:
                    bal = 0.0
                    failed = True
                else:
                    bal -= w
                    bal = max(0.0, bal * (1 + v["mean"] + v["sd"] * z))
                    w *= 1 + v["infl"]
            path.append(bal)
        if not failed:
            ok += 1
        paths.append(path)
    ending = sorted(p[-1] for p in paths)
    rows = []
    for y in range(years):
        col = sorted(p[y] for p in paths)
        rows.append([y + 1, percentile(col, 0.10), percentile(col, 0.50), percentile(col, 0.90)])
    return {
        "p_success": ok / sims,
        "p_end_p10": percentile(ending, 0.10),
        "p_end_p50": percentile(ending, 0.50),
        "p_end_p90": percentile(ending, 0.90),
    }, rows


def proj_retirement_mc(v):
    """Full-plan Monte Carlo: the retirement timeline's cash flows with a random return each year."""
    a0, ar, ae = int(v["age"]), int(v["retire"]), int(v["plan"])
    sims = int(v["sims"])
    rng = SplitMix(int(v["seed"]))
    years = ae - a0
    paths, retire_bals = [], []
    ok = 0
    for _ in range(sims):
        bal = v["bal"]
        failed = False
        path = []
        retire_bal = bal if ar <= a0 else None
        for age in range(a0, ae):
            t = age - a0
            z = rng.normal()
            if age == ar:
                retire_bal = bal
            if not failed:
                contrib = v["c"] * (1 + v["cg"]) ** t if age < ar else 0.0
                need = v["spend"] * (1 + v["infl"]) ** t if age >= ar else 0.0
                other = v["other"] * (1 + v["infl"]) ** t if (age >= ar and age >= v["oage"]) else 0.0
                w = max(0.0, need - other)
                if w > bal + contrib:
                    bal = 0.0
                    failed = True
                else:
                    mean = v["rpre"] if age < ar else v["rpost"]
                    bal = max(0.0, (bal + contrib - w) * (1 + mean + v["sd"] * z))
            path.append(bal)
        if retire_bal is None:
            retire_bal = bal
        if not failed:
            ok += 1
        paths.append(path)
        retire_bals.append(retire_bal)
    ending = sorted(p_[-1] for p_ in paths)
    rows = []
    for y in range(years):
        col = sorted(p_[y] for p_ in paths)
        rows.append([a0 + y + 1, percentile(col, 0.10), percentile(col, 0.50), percentile(col, 0.90)])
    return {
        "p_success": ok / sims,
        "p_retire_p50": percentile(sorted(retire_bals), 0.50),
        "p_end_p10": percentile(ending, 0.10),
        "p_end_p50": percentile(ending, 0.50),
        "p_end_p90": percentile(ending, 0.90),
    }, rows


def proj_growth(v):
    """Monthly compounding with end-of-month contributions, reported at each year end."""
    p, m, r, y, infl = v["p"], v["m"], v["r"], int(v["y"]), v["infl"]
    i = r / 12
    bal = p
    rows = []
    for year in range(1, y + 1):
        for _ in range(12):
            bal = bal * (1 + i) + m
        contributed = p + m * 12 * year
        rows.append([year, contributed, bal - contributed, bal, bal / (1 + infl) ** year])
    contributed = p + m * 12 * y
    return {
        "p_balance": bal,
        "p_contributed": contributed,
        "p_growth": bal - contributed,
        "p_real": bal / (1 + infl) ** y,
    }, rows


PROJECTIONS = {"retirement": proj_retirement, "montecarlo": proj_montecarlo,
               "retirementmc": proj_retirement_mc, "growth": proj_growth}
PROJECTION_TABLES = {
    "retirement": {"columns": [
        {"label": "Age", "format": "age"}, {"label": "Start balance", "format": "currency"},
        {"label": "Contributions", "format": "currency"}, {"label": "Withdrawals", "format": "currency"},
        {"label": "Growth", "format": "currency"}, {"label": "End balance", "format": "currency"}],
        "chartColumns": [5]},
    "montecarlo": {"columns": [
        {"label": "Year", "format": "number"}, {"label": "10th percentile", "format": "currency"},
        {"label": "Median", "format": "currency"}, {"label": "90th percentile", "format": "currency"}],
        "chartColumns": [1, 2, 3]},
    "retirementmc": {"columns": [
        {"label": "Age", "format": "age"}, {"label": "10th percentile", "format": "currency"},
        {"label": "Median", "format": "currency"}, {"label": "90th percentile", "format": "currency"}],
        "chartColumns": [1, 2, 3]},
    "growth": {"columns": [
        {"label": "Year", "format": "number"}, {"label": "Total contributed", "format": "currency"},
        {"label": "Total growth", "format": "currency"}, {"label": "Balance", "format": "currency"},
        {"label": "Balance in today's dollars", "format": "currency"}],
        "chartColumns": [3, 4]},
}

# ---------------------------------------------------------------------------
# Catalog definitions
# ---------------------------------------------------------------------------

DEFAULT_ASSUMPTIONS = ("Inputs refer to the same person, account and period. Rates are annual and compound "
                       "once per period unless stated. Taxes, fees and inflation are excluded unless entered.")
DEFAULT_INTERP = ("This is a mathematical result under the stated assumptions, not a recommendation. "
                  "Actual returns, tax law and personal circumstances vary.")
EXCEL_NOTES = ("Enter percentages in Excel as 7% or 0.07. Excel's PV/FV/PMT treat money paid out as negative, "
               "so some formulas carry a minus sign to show a positive result.")
TAX_INTERP = ("Uses the IRS figures for the tax year selected in the app (shown above the inputs, with its IRS sources). "
              "Excludes state tax, AMT, credits, phase-outs and payroll taxes.")

HINTS = {
    "$": "Dollar amount; k and m suffixes work (250k, 1.2m).",
    "%": "Enter 7 for 7%, or type 7%.",
    "years": "Number of years.",
    "age": "Age in whole years.",
    "series": "Separate values with semicolons or new lines.",
    "choice": "Pick one.",
    "count": "A whole number.",
    "x": "A plain number.",
}

SRC = {
    "compound": {"title": "Investor.gov • Compound interest calculator", "url": "https://www.investor.gov/financial-tools-calculators/calculators/compound-interest-calculator"},
    "fees": {"title": "SEC • How fees and expenses affect your portfolio", "url": "https://www.sec.gov/investor/alerts/ib_investmentfees.pdf"},
    "brackets": {"title": "IRS • Federal income tax rates and brackets", "url": "https://www.irs.gov/filing/federal-income-tax-rates-and-brackets"},
    "capgains": {"title": "IRS • Topic 409, Capital gains and losses", "url": "https://www.irs.gov/taxtopics/tc409"},
    "niit": {"title": "IRS • Net investment income tax", "url": "https://www.irs.gov/individuals/net-investment-income-tax"},
    "rmd": {"title": "IRS • Publication 590-B (distributions from IRAs)", "url": "https://www.irs.gov/publications/p590b"},
    "401k": {"title": "IRS • 401(k) contribution limits", "url": "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-401k-and-profit-sharing-plan-contribution-limits"},
    "ira": {"title": "IRS • IRA contribution limits", "url": "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-ira-contribution-limits"},
    "ss": {"title": "SSA • Benefit reduction for early retirement", "url": "https://www.ssa.gov/benefits/retirement/planner/agereduction.html"},
    "estate": {"title": "IRS • Estate tax", "url": "https://www.irs.gov/businesses/small-businesses-self-employed/estate-tax"},
    "treasury": {"title": "U.S. Treasury • Daily par yield curve rates", "url": "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve"},
    "tbills": {"title": "TreasuryDirect • Treasury bills", "url": "https://www.treasurydirect.gov/marketable-securities/treasury-bills/"},
    "bonds": {"title": "Investor.gov • Bonds", "url": "https://www.investor.gov/introduction-investing/investing-basics/investment-products/bonds-or-fixed-income-products/bonds"},
    "nist": {"title": "NIST/SEMATECH • e-Handbook of Statistical Methods", "url": "https://www.itl.nist.gov/div898/handbook/"},
    "openstax_stats": {"title": "OpenStax • Introductory Statistics", "url": "https://openstax.org/details/books/introductory-statistics-2e"},
    "openstax_econ": {"title": "OpenStax • Principles of Economics", "url": "https://openstax.org/details/books/principles-economics-3e"},
    "bls_cpi": {"title": "BLS • Consumer Price Index", "url": "https://www.bls.gov/cpi/"},
    "bls_cps": {"title": "BLS • Labor force statistics (CPS)", "url": "https://www.bls.gov/cps/"},
    "gift": {"title": "IRS • Gift tax FAQs", "url": "https://www.irs.gov/businesses/small-businesses-self-employed/frequently-asked-questions-on-gift-taxes"},
}

CATALOG = []


def F(id, label, unit, example, hint=None, min=0, max=None, integer=False, options=None, default=None):
    f = {"id": id, "label": label, "unit": unit, "example": example, "hint": hint or HINTS[unit]}
    if default is not None:
        f["default"] = default   # pre-filled technical setting (never a dollar amount or a market assumption)
    if min is not None:
        f["min"] = min
    if max is not None:
        f["max"] = max
    if integer or unit in ("age", "count", "choice"):
        f["integer"] = True
    if unit == "choice":
        f["options"] = options or TAX["statuses"]
    return f


STATUS = lambda: F("status", "Filing status", "choice", "2")


def O(id, label, expr, fmt, excel=None):
    return {"id": id, "label": label, "expression": expr, "format": fmt, "excel": excel}


def R(left, rel, right, msg):
    return {"left": left, "relation": rel, "right": right, "message": msg}


def calc(id, name, category, fields, outputs, math, summary, aliases="", acronym="",
         assumptions=DEFAULT_ASSUMPTIONS, interpretation=DEFAULT_INTERP, rules=(),
         common=False, sources=(), projection=None, excelNotes=EXCEL_NOTES):
    CATALOG.append({
        "id": id, "name": name, "category": category, "fields": fields, "outputs": outputs,
        "math": math, "summary": summary, "aliases": aliases, "acronym": acronym,
        "assumptions": assumptions, "interpretation": interpretation, "excelNotes": excelNotes,
        "rules": list(rules), "common": common, "sources": [SRC[s] for s in sources],
        "projection": projection,
    })


EV = "Everyday math"
G = "Growth & time value"
RET = "Retirement & income"
TX = "Tax"
PF = "Portfolio & risk"
FEE = "Fees & costs"
SB = "Stocks & bonds"
ST = "Statistics & econometrics"
EC = "Economics"
PL = "Planning & protection"

# --- Everyday math --------------------------------------------------------------------
calc("percentages", "Percentages", EV,
     [F("pct", "Percent", "%", "15", min=None, max=None), F("of", "…of this number", "x", "240", min=None),
      F("part", "Part", "x", "45", min=None), F("whole", "…as a share of whole", "x", "180", min=None),
      F("old", "Old value", "x", "80", min=None), F("new", "New value", "x", "92", min=None)],
     [O("0", "Percent of number", "pct*of", "number", "={pct}*{of}"),
      O("1", "Part as % of whole", "part/whole", "percent", "={part}/{whole}"),
      O("2", "% change old → new", "(new-old)/abs(old)", "percent", "=({new}-{old})/ABS({old})"),
      O("3", "Number increased by percent", "of*(1+pct)", "number", "={of}*(1+{pct})"),
      O("4", "Number decreased by percent", "of*(1-pct)", "number", "={of}*(1-{pct})")],
     "x% of y = x/100 × y; part ÷ whole; (new − old) ÷ |old|",
     "The everyday percentage questions in one place.", "percent of percentage change increase decrease share ratio",
     common=True, rules=[R("whole", "!=", "0", "Whole can't be zero."), R("old", "!=", "0", "Old value can't be zero.")],
     assumptions="Plain arithmetic.", interpretation="Percentage change is relative to the old value; a change in a rate (e.g. 4% → 5%) is also 1 percentage point.")

calc("tip_split", "Tip & bill split", EV,
     [F("bill", "Bill (before tip)", "$", "184.50"), F("tip", "Tip", "%", "20", max=1),
      F("tax", "Tax already in the bill", "$", "15.20", hint="Tip is calculated on the bill minus this tax; 0 to tip on the full bill."),
      F("people", "People", "count", "4", min=1)],
     [O("0", "Tip", "(bill-tax)*tip", "currency", "=({bill}-{tax})*{tip}"),
      O("1", "Total", "bill+(bill-tax)*tip", "currency", "={bill}+({bill}-{tax})*{tip}"),
      O("2", "Per person", "(bill+(bill-tax)*tip)/people", "currency", "=({bill}+({bill}-{tax})*{tip})/{people}")],
     "Tip = (bill − tax) × rate; per person = total ÷ people", "Tip, total and each person's share.",
     "tip gratuity restaurant split check", rules=[R("tax", "<=", "bill", "Tax can't exceed the bill.")], assumptions="Plain arithmetic; rounding to the cent is up to you.")

calc("discount", "Discount & sales tax", EV,
     [F("price", "List price", "$", "250"), F("d1", "Discount", "%", "30", max=1),
      F("d2", "Extra discount (applied after)", "%", "10", max=1), F("tax", "Sales tax", "%", "8.25", max=1)],
     [O("0", "Sale price", "price*(1-d1)*(1-d2)", "currency", "={price}*(1-{d1})*(1-{d2})"),
      O("1", "You save", "price-price*(1-d1)*(1-d2)", "currency", "={price}-{price}*(1-{d1})*(1-{d2})"),
      O("2", "Effective total discount", "1-(1-d1)*(1-d2)", "percent", "=1-(1-{d1})*(1-{d2})"),
      O("3", "Total with tax", "price*(1-d1)*(1-d2)*(1+tax)", "currency", "={price}*(1-{d1})*(1-{d2})*(1+{tax})")],
     "Price × (1 − d₁)(1 − d₂) × (1 + tax)", "Stacked discounts, what you save, and the total after sales tax.",
     "sale discount percent off coupon sales tax", assumptions="Discounts stack multiplicatively (30% then 10% is 37% off, not 40%). Tax applies to the discounted price.")

calc("unit_price", "Unit price comparison", EV,
     [F("pa", "Price of option A", "$", "8.99"), F("qa", "Quantity in A", "x", "24", min=0.0000001, hint="Ounces, count, etc."),
      F("pb", "Price of option B", "$", "13.49"), F("qb", "Quantity in B", "x", "40", min=0.0000001, hint="Same unit as A.")],
     [O("0", "Unit price A", "pa/qa", "currency", "={pa}/{qa}"),
      O("1", "Unit price B", "pb/qb", "currency", "={pb}/{qb}"),
      O("2", "B vs. A per unit (− = B cheaper)", "(pb/qb)/(pa/qa)-1", "percent", "=({pb}/{qb})/({pa}/{qa})-1")],
     "Price ÷ quantity", "Which size or package is the better deal per unit.", "unit price per ounce bulk compare cheaper")

calc("weighted_avg", "Weighted average (grades)", EV,
     [F("x", "Scores", "series", "92; 85; 78; 88", min=None), F("w", "Weights (% or points)", "series", "20; 30; 15; 35", min=None)],
     [O("0", "Weighted average", "sumproduct(x,w)/sum(w)", "number", "=SUMPRODUCT({x},{w})/SUM({w})"),
      O("1", "Simple average", "avg(x)", "number", "=AVERAGE({x})"),
      O("2", "Total weight", "sum(w)", "number", "=SUM({w})")],
     "Σ(score × weight) ÷ Σ weight", "Course grade or any average where items count differently.",
     "weighted average grade gpa course final exam", common=True,
     rules=[R("count(x)", "==", "count(w)", "Enter the same number of scores and weights."), R("sum(w)", ">", "0", "Weights must add up to more than zero.")],
     assumptions="Weights don't need to add to 100; they're normalized.")

calc("grade_needed", "Final exam score needed", EV,
     [F("cur", "Current grade (before final)", "x", "84", min=None), F("wf", "Final exam weight", "%", "30", min=0.0001, max=1),
      F("target", "Target course grade", "x", "88", min=None)],
     [O("0", "Score needed on the final", "(target-cur*(1-wf))/wf", "number", "=({target}-{cur}*(1-{wf}))/{wf}")],
     "(target − current × (1 − w)) ÷ w", "What you need on the final to reach a target course grade.",
     "final exam grade needed what do i need", assumptions="Current grade covers everything except the final, on the same scale as the target.")

# --- Growth & time value ----------------------------------------------------
calc("fv_lump", "Future value of a lump sum", G,
     [F("p", "Amount invested today", "$", "100000"), F("r", "Annual return", "%", "7", min=-0.99),
      F("n", "Years", "years", "20")],
     [O("0", "Future value", "p*(1+r)^n", "currency", "=FV({r},{n},0,-{p})"),
      O("1", "Total growth", "p*(1+r)^n-p", "currency", "=FV({r},{n},0,-{p})-{p}")],
     "Amount × (1 + return)^years", "What a single investment grows to at a steady annual return.",
     "compound growth lump sum", sources=["compound"], common=True)

calc("fv_contrib", "Future value with annual contributions", G,
     [F("p", "Starting balance", "$", "50000"), F("c", "Contribution each year", "$", "10000"),
      F("r", "Annual return", "%", "6", min=-0.99), F("n", "Years", "years", "25")],
     [O("0", "Future value", "fv(r,n,c,p)", "currency", "=FV({r},{n},-{c},-{p})"),
      O("1", "Total contributed", "p+c*n", "currency", "={p}+{c}*{n}"),
      O("2", "Investment growth", "fv(r,n,c,p)-p-c*n", "currency", "=FV({r},{n},-{c},-{p})-{p}-{c}*{n}")],
     "Balance × (1+r)^n + contribution × ((1+r)^n − 1) / r",
     "Growth of a balance plus a level contribution at the end of each year.",
     "savings growth annuity 401k ira accumulate", sources=["compound"])

calc("fv_monthly", "Future value with monthly savings", G,
     [F("p", "Starting balance", "$", "25000"), F("m", "Monthly contribution", "$", "1000"),
      F("r", "Annual return", "%", "7", min=-0.99), F("y", "Years", "years", "30")],
     [O("0", "Future value", "fv(r/12,y*12,m,p)", "currency", "=FV({r}/12,{y}*12,-{m},-{p})"),
      O("1", "Total contributed", "p+m*12*y", "currency", "={p}+{m}*12*{y}")],
     "Monthly rate = annual ÷ 12; FV over years × 12 months",
     "Growth of a balance plus monthly deposits, compounded monthly.",
     "monthly savings compound", sources=["compound"], common=True)

calc("pv_goal", "Present value of a future goal", G,
     [F("g", "Future amount needed", "$", "250000"), F("r", "Annual return", "%", "6", min=-0.99),
      F("n", "Years until needed", "years", "15")],
     [O("0", "Amount to invest today", "g/(1+r)^n", "currency", "=PV({r},{n},0,-{g})")],
     "Goal ÷ (1 + r)^years", "Lump sum needed today to reach a future amount.",
     "discount goal lump sum needed today")

calc("savings_needed", "Annual savings to reach a goal", G,
     [F("g", "Goal amount", "$", "1000000"), F("p", "Saved so far", "$", "150000"),
      F("r", "Annual return", "%", "6", min=0.0001), F("n", "Years", "years", "20")],
     [O("0", "Required annual savings", "max(0,(g-p*(1+r)^n)*r/((1+r)^n-1))", "currency",
        "=MAX(0,-PMT({r},{n},-{p},{g}))"),
      O("1", "Monthly equivalent (÷12)", "max(0,(g-p*(1+r)^n)*r/((1+r)^n-1))/12", "currency",
        "=MAX(0,-PMT({r},{n},-{p},{g}))/12")],
     "(Goal − current × (1+r)^n) × r ÷ ((1+r)^n − 1)",
     "Level end-of-year saving that closes the gap between what you have and a goal.",
     "sinking fund how much to save", rules=[R("r", ">", "0", "Return must be greater than zero.")])

calc("years_to_goal", "Years to reach a goal", G,
     [F("p", "Current balance", "$", "200000"), F("c", "Contribution each year", "$", "20000"),
      F("g", "Goal", "$", "1000000"), F("r", "Annual return", "%", "7", min=0.0001)],
     [O("0", "Years needed", "nper(r,c,p,g)", "years", "=NPER({r},-{c},-{p},{g})")],
     "ln((goal × r + c) ÷ (balance × r + c)) ÷ ln(1 + r)",
     "How long until a growing balance with steady contributions reaches a target.",
     "time to goal how long nper",
     rules=[R("g", ">", "p", "Goal must exceed the current balance."),
            R("r", ">", "0", "Return must be greater than zero.")])

calc("cagr", "Compound annual growth rate", G,
     [F("s", "Starting value", "$", "100000", min=0.01), F("e", "Ending value", "$", "180000"),
      F("n", "Years", "years", "6", min=0.01)],
     [O("0", "CAGR", "(e/s)^(1/n)-1", "percent", "=({e}/{s})^(1/{n})-1")],
     "(End ÷ start)^(1 ÷ years) − 1", "Smoothed annual growth between two values.",
     "annualized growth rate", acronym="CAGR", common=True)

calc("real_return", "Real (inflation-adjusted) return", G,
     [F("r", "Nominal return", "%", "7", min=-0.99), F("i", "Inflation", "%", "3", min=-0.5)],
     [O("0", "Real return", "(1+r)/(1+i)-1", "percent", "=(1+{r})/(1+{i})-1"),
      O("1", "Shortcut (nominal − inflation)", "r-i", "percent", "={r}-{i}")],
     "(1 + nominal) ÷ (1 + inflation) − 1", "Return after removing inflation's effect on purchasing power.",
     "fisher purchasing power inflation adjusted")

calc("rule72", "Doubling time (Rule of 72)", G,
     [F("r", "Annual return", "%", "8", min=0.0001)],
     [O("0", "Rule-of-72 estimate", "72/(r*100)", "years", "=72/({r}*100)"),
      O("1", "Exact doubling time", "ln(2)/ln(1+r)", "years", "=LN(2)/LN(1+{r})")],
     "72 ÷ rate in percent (exact: ln 2 ÷ ln(1+r))", "How many years it takes money to double.",
     "double money rule of 72")

calc("inflation_cost", "Future cost with inflation", G,
     [F("c", "Cost in today's dollars", "$", "80000"), F("i", "Inflation", "%", "3", min=-0.5),
      F("n", "Years", "years", "20")],
     [O("0", "Future cost", "c*(1+i)^n", "currency", "={c}*(1+{i})^{n}"),
      O("1", "Today's value of the same dollars then", "c/(1+i)^n", "currency", "={c}/(1+{i})^{n}")],
     "Cost × (1 + inflation)^years", "What today's expense costs later, and what the same dollar amount buys then.",
     "purchasing power inflation future dollars")

calc("effective_rate", "Nominal to effective annual rate", G,
     [F("r", "Nominal annual rate (APR)", "%", "5"), F("m", "Compounding periods per year", "count", "12", min=1)],
     [O("0", "Effective annual rate (APY)", "(1+r/m)^m-1", "percent", "=EFFECT({r},{m})")],
     "(1 + APR ÷ periods)^periods − 1", "Annual yield once compounding is included.",
     "apy apr effective yield", acronym="APY")

# --- Retirement & income ------------------------------------------------------
calc("nest_egg", "Retirement nest egg needed", RET,
     [F("s", "Annual spending in retirement", "$", "120000"), F("o", "Other income (Social Security, pension)", "$", "40000"),
      F("w", "Withdrawal rate", "%", "4", min=0.0001, max=1)],
     [O("0", "Portfolio needed", "max(0,s-o)/w", "currency", "=MAX(0,{s}-{o})/{w}"),
      O("1", "Annual draw from portfolio", "max(0,s-o)", "currency", "=MAX(0,{s}-{o})")],
     "(Spending − other income) ÷ withdrawal rate",
     "Portfolio size that supports a spending gap at a chosen withdrawal rate.",
     "4% rule safe withdrawal target number", common=True,
     interpretation="A withdrawal rate is an assumption, not a guarantee. Lower rates are more conservative; "
                    "use the Monte Carlo and timeline tools to test a plan.")

calc("retire_gap", "Retirement savings gap", RET,
     [F("s", "Annual spending in retirement", "$", "120000"), F("o", "Other income", "$", "40000"),
      F("w", "Withdrawal rate", "%", "4", min=0.0001, max=1), F("b", "Saved today", "$", "600000"),
      F("c", "Saving each year until retirement", "$", "30000"), F("r", "Return until retirement", "%", "6", min=-0.99),
      F("n", "Years until retirement", "years", "15")],
     [O("0", "Portfolio needed", "max(0,s-o)/w", "currency", "=MAX(0,{s}-{o})/{w}"),
      O("1", "Projected portfolio", "fv(r,n,c,b)", "currency", "=FV({r},{n},-{c},-{b})"),
      O("2", "Surplus (+) / shortfall (−)", "fv(r,n,c,b)-max(0,s-o)/w", "currency",
        "=FV({r},{n},-{c},-{b})-MAX(0,{s}-{o})/{w}")],
     "Projected FV of savings − spending gap ÷ withdrawal rate",
     "Compares what you're on track to have against what the spending goal needs.",
     "on track shortfall surplus")

calc("withdrawal_rate", "Current withdrawal rate", RET,
     [F("w", "Annual withdrawals", "$", "60000"), F("b", "Portfolio balance", "$", "1500000", min=0.01)],
     [O("0", "Withdrawal rate", "w/b", "percent", "={w}/{b}")],
     "Withdrawals ÷ balance", "Share of the portfolio taken out each year.", "spending rate draw")

calc("level_withdrawal", "Level withdrawal over a set period", RET,
     [F("b", "Starting balance", "$", "1000000"), F("r", "Annual return", "%", "5", min=-0.99),
      F("n", "Years it must last", "years", "30", min=1)],
     [O("0", "Annual withdrawal (end of year)", "pmt(r,n,b)", "currency", "=PMT({r},{n},-{b})")],
     "Balance × r ÷ (1 − (1+r)^−n)", "Fixed yearly amount that spends a balance to zero over a set number of years.",
     "annuity payout drawdown spend down")

calc("longevity", "How long money lasts", RET,
     [F("b", "Starting balance", "$", "800000"), F("w", "Withdrawal each year", "$", "60000", min=0.01),
      F("r", "Annual return", "%", "5", min=0.0001)],
     [O("0", "Years until depleted", "nper(r,-w,b,0)", "years", "=NPER({r},{w},-{b})")],
     "ln(w ÷ (w − balance × r)) ÷ ln(1 + r)",
     "Years a balance supports a fixed end-of-year withdrawal. Withdrawals at or below the return never run out.",
     "depletion runway last",
     rules=[R("w", ">", "b*r", "Withdrawal must exceed the balance's annual return, or the money never runs out.")])

calc("growing_annuity", "Funding inflation-adjusted spending", RET,
     [F("s", "First-year spending", "$", "80000"), F("n", "Years of spending", "years", "30", min=1),
      F("r", "Annual return", "%", "5", min=-0.99), F("g", "Annual spending increase", "%", "3", min=-0.5)],
     [O("0", "Amount needed at the start", "if(r==g, s*n/(1+r), s/(r-g)*(1-((1+g)/(1+r))^n))", "currency",
        "=IF({r}={g},{s}*{n}/(1+{r}),{s}/({r}-{g})*(1-((1+{g})/(1+{r}))^{n}))")],
     "Spending ÷ (r − g) × (1 − ((1+g) ÷ (1+r))^n)",
     "Present value of spending that rises each year, first payment at the end of year one.",
     "growing annuity present value inflation adjusted income")

calc("ss_breakeven", "Social Security claiming break-even", RET,
     [F("e", "Earlier claiming age", "age", "62"), F("a1", "Monthly benefit at earlier age", "$", "2100"),
      F("l", "Later claiming age", "age", "70"), F("a2", "Monthly benefit at later age", "$", "3720")],
     [O("0", "Break-even age", "(a2*l-a1*e)/(a2-a1)", "age", "=({a2}*{l}-{a1}*{e})/({a2}-{a1})"),
      O("1", "Benefits forgone by waiting", "a1*12*(l-e)", "currency", "={a1}*12*({l}-{e})")],
     "(Later benefit × later age − earlier benefit × earlier age) ÷ (later − earlier benefit)",
     "Age at which cumulative benefits from waiting catch up with claiming early.",
     "claiming age delay benefits break even",
     rules=[R("l", ">", "e", "Later age must exceed earlier age."),
            R("a2", ">", "a1", "Later benefit must exceed earlier benefit.")],
     assumptions="Ignores cost-of-living increases, taxes, investment returns on early benefits, and spousal or survivor benefits.",
     sources=["ss"])

calc("pension_value", "Pension: lump sum vs. monthly annuity", RET,
     [F("b", "Monthly pension", "$", "3000"), F("n", "Years of payments expected", "years", "25", min=1),
      F("r", "Discount rate", "%", "5", min=0), F("l", "Lump sum offered", "$", "500000")],
     [O("0", "Present value of the annuity", "pv(r/12,n*12,b)", "currency", "=PV({r}/12,{n}*12,-{b})"),
      O("1", "Lump sum minus annuity value", "l-pv(r/12,n*12,b)", "currency", "={l}-PV({r}/12,{n}*12,-{b})"),
      O("2", "Return the lump sum must earn to match", "rate(n*12,b,l)*12", "percent", "=RATE({n}*12,{b},-{l})*12")],
     "PV of monthly payments at discount rate ÷ 12", "Compares a pension lump sum with the value of its monthly payments.",
     "lump sum annuity election pension buyout",
     assumptions="Level payments with no cost-of-living adjustment, paid at month end, for a fixed number of years. Ignores survivor options and insurer or plan credit risk.")

calc("rmd", "Required minimum distribution", RET,
     [F("b", "Balance on Dec 31 of prior year", "$", "900000"), F("a", "Age at end of this year", "age", "75", min=72, max=120)],
     [O("0", "RMD for the year", "b/rmdfactor(a)", "currency", "={b}/VLOOKUP({a},UniformTable,2,FALSE)"),
      O("1", "Distribution period (factor)", "rmdfactor(a)", "number", "=VLOOKUP({a},UniformTable,2,FALSE)"),
      O("2", "As a share of the balance", "1/rmdfactor(a)", "percent", "=1/VLOOKUP({a},UniformTable,2,FALSE)")],
     "Prior year-end balance ÷ Uniform Lifetime Table factor",
     "Minimum withdrawal from IRAs and similar accounts using the IRS Uniform Lifetime Table.",
     "rmd required minimum distribution ira uniform lifetime", acronym="RMD",
     assumptions="Uses the Uniform Lifetime Table. A spouse more than 10 years younger and sole beneficiary uses the Joint Life table instead. Inherited accounts follow different rules.",
     interpretation=TAX_INTERP, sources=["rmd"], common=True,
     excelNotes="Excel needs the IRS Uniform Lifetime Table on a sheet named UniformTable (age in column A, factor in column B).")

calc("contrib_limits", "Contribution limits (401(k) and IRA)", RET,
     [F("a", "Age at end of year", "age", "61", min=18, max=120), F("k", "401(k) deferrals so far", "$", "10000"),
      F("i", "IRA contributions so far", "$", "0")],
     [O("0", "401(k) employee limit", "limit401k(a)", "currency", None),
      O("1", "401(k) room left", "max(0,limit401k(a)-k)", "currency", None),
      O("2", "IRA limit", "limitira(a)", "currency", None),
      O("3", "IRA room left", "max(0,limitira(a)-i)", "currency", None)],
     "Base limit + age-based catch-up (age 60–63 uses the larger catch-up)",
     "Employee 401(k)/403(b) deferral and IRA limits for the tax year, including catch-up contributions.",
     "401k 403b ira catch up max out limits",
     assumptions="Employee deferral limits only; excludes employer contributions, the overall annual-additions limit, Roth IRA income phase-outs, and the Roth catch-up requirement for higher earners.",
     interpretation=TAX_INTERP, sources=["401k", "ira"],
     excelNotes="Limits come from the app's dated tax table; there is no Excel formula.")

calc("employer_match", "Employer match", RET,
     [F("s", "Salary", "$", "150000"), F("c", "Your contribution rate", "%", "4", max=1),
      F("m", "Employer matches this share", "%", "50", max=2), F("cap", "…of contributions up to", "%", "6", max=1)],
     [O("0", "Employer match per year", "s*min(c,cap)*m", "currency", "={s}*MIN({c},{cap})*{m}"),
      O("1", "Match left unclaimed", "s*max(0,cap-c)*m", "currency", "={s}*MAX(0,{cap}-{c})*{m}")],
     "Salary × min(your rate, cap) × match share", "Employer contribution earned and any match left on the table.",
     "401k match free money")

calc("retirement_timeline", "Retirement timeline", RET,
     [F("age", "Current age", "age", "45", max=110), F("retire", "Retirement age", "age", "65", max=110),
      F("plan", "Plan through age", "age", "95", max=120), F("bal", "Invested today", "$", "750000"),
      F("c", "Saving each year while working", "$", "30000"), F("cg", "Annual increase in saving", "%", "2", min=-0.5),
      F("rpre", "Return before retirement", "%", "6", min=-0.99), F("rpost", "Return in retirement", "%", "5", min=-0.99),
      F("spend", "Retirement spending (today's $)", "$", "110000"), F("infl", "Inflation", "%", "2.5", min=-0.5),
      F("other", "Other income in retirement (today's $)", "$", "45000"), F("oage", "Other income starts at age", "age", "67", max=120)],
     [O("0", "Balance at retirement", "p_retire_balance", "currency"),
      O("1", "First-year withdrawal (nominal)", "p_first_withdrawal", "currency"),
      O("2", "Balance at end of plan", "p_end_balance", "currency"),
      O("3", "Age money runs out", "p_depletion_age", "age"),
      O("4", "Total withdrawn", "p_total_withdrawn", "currency")],
     "Each year: (start + saving − withdrawal) × (1 + return); spending and other income grow with inflation",
     "Year-by-year projection from today through the end of the plan.",
     "projection cash flow plan retirement income timeline", common=True, projection="retirement",
     rules=[R("plan", ">", "age", "Plan age must exceed current age."),
            R("retire", ">=", "age", "Retirement age can't be before current age."),
            R("plan-age", "<=", "100", "Projection is limited to 100 years.")],
     assumptions="Saving is added and withdrawals taken at the start of each year, then the year's return applies. Spending and other income are in today's dollars and grow with inflation; other income only offsets spending once retired. Pre-tax and after-tax money are not distinguished, and taxes are excluded.",
     excelNotes="This is a year-by-year table, not a single formula. Use Copy table and paste into Excel.")

calc("retirement_mc", "Retirement Monte Carlo (full plan)", RET,
     [F("age", "Current age", "age", "45", max=110), F("retire", "Retirement age", "age", "65", max=110),
      F("plan", "Plan through age", "age", "95", max=120), F("bal", "Invested today", "$", "750000"),
      F("c", "Saving each year while working", "$", "30000"), F("cg", "Annual increase in saving", "%", "2", min=-0.5),
      F("rpre", "Average return before retirement", "%", "6", min=-0.5), F("rpost", "Average return in retirement", "%", "5", min=-0.5),
      F("sd", "Volatility (standard deviation)", "%", "12", max=1),
      F("spend", "Retirement spending (today's $)", "$", "110000"), F("infl", "Inflation", "%", "2.5", min=-0.5),
      F("other", "Other income in retirement (today's $)", "$", "45000"), F("oage", "Other income starts at age", "age", "67", max=120),
      F("sims", "Number of simulations", "count", "1000", min=100, max=20000, default="1000"),
      F("seed", "Random seed", "count", "42", hint="Same seed gives the same result; change it to see a different draw.", default="42")],
     [O("0", "Chance the money lasts through the plan", "p_success", "percent"),
      O("1", "Median balance at retirement", "p_retire_p50", "currency"),
      O("2", "Ending balance: 10th percentile", "p_end_p10", "currency"),
      O("3", "Ending balance: median", "p_end_p50", "currency"),
      O("4", "Ending balance: 90th percentile", "p_end_p90", "currency")],
     "Retirement timeline cash flows, with each year's return drawn from Normal(average, volatility)",
     "Simulates the whole plan, saving years and retirement years, across many market paths.",
     "monte carlo retirement probability success simulation plan", projection="retirementmc",
     rules=[R("plan", ">", "age", "Plan age must exceed current age."),
            R("retire", ">=", "age", "Retirement age can't be before current age."),
            R("plan-age", "<=", "100", "Projection is limited to 100 years.")],
     assumptions="Same cash-flow rules as the Retirement timeline (saving added and withdrawals taken at the start of each year). Annual returns are independent normal draws; real markets have fatter tails and streaks. Taxes and fees are excluded.",
     interpretation="The success rate summarizes simulated outcomes under the assumptions entered. It is not a forecast or a guarantee, and it is not a recommendation.",
     excelNotes="Simulation results aren't a cell formula. Use Copy table for the percentile paths.")

calc("growth_schedule", "Investment growth schedule", G,
     [F("p", "Starting amount", "$", "25000"), F("m", "Monthly contribution", "$", "1000"),
      F("r", "Annual return", "%", "6", min=-0.5), F("y", "Years", "years", "25", min=1, max=100, integer=True),
      F("infl", "Inflation", "%", "2.5", min=-0.5)],
     [O("0", "Ending balance", "p_balance", "currency"),
      O("1", "Total contributed", "p_contributed", "currency"),
      O("2", "Total growth", "p_growth", "currency"),
      O("3", "Ending balance in today's dollars", "p_real", "currency")],
     "Each month: balance × (1 + annual return ÷ 12) + contribution; today's dollars = balance ÷ (1 + inflation)^years",
     "Year-by-year growth of savings, split into what you put in and what it earned, with inflation's effect.",
     "compound growth schedule table contributions inflation today's dollars", projection="growth",
     assumptions="Monthly compounding at a constant return, contributions at the end of each month. Taxes and fees are excluded.",
     excelNotes="Balance: =FV(r/12, years*12, -monthly, -start). The yearly table is available via Copy table.")

calc("mix_volatility", "Portfolio mix volatility", PF,
     [F("v", "Portfolio value", "$", "2000000", min=0.01), F("we", "Stocks", "%", "60", max=1), F("wb", "Bonds", "%", "40", max=1),
      F("sa", "Stock volatility (standard deviation)", "%", "16", max=2), F("sb", "Bond volatility (standard deviation)", "%", "6", max=2),
      F("rho", "Stock/bond correlation", "x", "0.1", min=-1, max=1, hint="Between −1 and 1.")],
     [O("0", "Portfolio volatility", "sqrt(we^2*sa^2+wb^2*sb^2+2*we*wb*rho*sa*sb)", "percent",
        "=SQRT({we}^2*{sa}^2+{wb}^2*{sb}^2+2*{we}*{wb}*{rho}*{sa}*{sb})"),
      O("1", "One-standard-deviation move in dollars", "v*sqrt(we^2*sa^2+wb^2*sb^2+2*we*wb*rho*sa*sb)", "currency",
        "={v}*SQRT({we}^2*{sa}^2+{wb}^2*{sb}^2+2*{we}*{wb}*{rho}*{sa}*{sb})"),
      O("2", "Share of risk coming from stocks", "if(we^2*sa^2+wb^2*sb^2+2*we*wb*rho*sa*sb>0,(we^2*sa^2+we*wb*rho*sa*sb)/(we^2*sa^2+wb^2*sb^2+2*we*wb*rho*sa*sb),0)", "percent")],
     "σ = √(wS²σS² + wB²σB² + 2·wS·wB·ρ·σS·σB); cash adds no volatility",
     "How much a stock/bond/cash mix is expected to fluctuate, given the volatility assumptions you enter.",
     "volatility standard deviation risk allocation mix diversification",
     rules=[R("we+wb", "<=", "1", "Stocks and bonds can't exceed 100%; the rest is cash.")],
     assumptions="Volatilities and correlation are your assumptions and change over time. Cash is treated as riskless. Returns are not assumed to be normal, so a one-standard-deviation move is a yardstick, not a probability.",
     interpretation="Volatility describes typical fluctuation around an average, not the worst case. Use the stress test for specific what-if moves.")

calc("portfolio_stress", "Portfolio stress test", PF,
     [F("v", "Portfolio value", "$", "2000000", min=0.01), F("we", "Stocks", "%", "60", max=1),
      F("wb", "Bonds", "%", "40", max=1), F("eq", "Stock market change", "%", "-20", min=-1, max=1),
      F("dy", "Change in interest rates", "%", "1", min=-0.1, max=0.1, hint="Enter 1 for +1% (100 bp), −0.5 for −0.5%."),
      F("dur", "Bond duration", "years", "6", min=0, max=30, hint="Rate sensitivity of the bond holdings; core bond funds are roughly 6."),
      F("infl", "Inflation over the period", "%", "3", min=-0.2, max=1),
      F("w", "Withdrawal during the period", "$", "0")],
     [O("0", "Change in stock holdings", "v*we*eq", "currency", "={v}*{we}*{eq}"),
      O("1", "Change in bond holdings", "v*wb*(-dur*dy)", "currency", "={v}*{wb}*(-{dur}*{dy})"),
      O("2", "Total change in value", "v*we*eq+v*wb*(-dur*dy)", "currency", "={v}*{we}*{eq}+{v}*{wb}*(-{dur}*{dy})"),
      O("3", "Total change (%)", "we*eq+wb*(-dur*dy)", "percent", "={we}*{eq}+{wb}*(-{dur}*{dy})"),
      O("4", "Value after the scenario and withdrawal", "v*(1+we*eq+wb*(-dur*dy))-w", "currency", "={v}*(1+{we}*{eq}+{wb}*(-{dur}*{dy}))-{w}"),
      O("5", "Purchasing power after inflation", "(v*(1+we*eq+wb*(-dur*dy))-w)/(1+infl)", "currency", "=({v}*(1+{we}*{eq}+{wb}*(-{dur}*{dy}))-{w})/(1+{infl})"),
      O("6", "Stock weight after the move", "v*we*(1+eq)/(v*(1+we*eq+wb*(-dur*dy)))", "percent", "={v}*{we}*(1+{eq})/({v}*(1+{we}*{eq}+{wb}*(-{dur}*{dy})))"),
      O("7", "Rebalance: buy (+) / sell (−) stocks", "we*(v*(1+we*eq+wb*(-dur*dy))-w)-v*we*(1+eq)", "currency", "={we}*({v}*(1+{we}*{eq}+{wb}*(-{dur}*{dy}))-{w})-{v}*{we}*(1+{eq})"),
      O("8", "Rebalance: buy (+) / sell (−) bonds", "wb*(v*(1+we*eq+wb*(-dur*dy))-w)-v*wb*(1-dur*dy)", "currency", "={wb}*({v}*(1+{we}*{eq}+{wb}*(-{dur}*{dy}))-{w})-{v}*{wb}*(1-{dur}*{dy})")],
     "Stocks × market change + bonds × (−duration × rate change); cash unchanged",
     "Deterministic what-if: the immediate effect of a market move you specify on a stock/bond/cash mix.",
     "stress test scenario market decline crash rates allocation 60/40 shock what if", common=True,
     rules=[R("we+wb", "<=", "1", "Stocks and bonds can't exceed 100%; the rest is cash."),
            R("w", "<=", "v*(1+we*eq+wb*(-dur*dy))", "The withdrawal is larger than the portfolio after the scenario.")],
     assumptions="An instantaneous, user-specified shock, not a forecast. Bond prices move by −duration × rate change (a first-order approximation that ignores convexity, coupon income and credit spreads). Cash is unaffected. Rebalancing restores the target stock and bond weights after the withdrawal, with the remainder in cash.",
     interpretation="This shows what happens if the scenario you enter occurs. It says nothing about how likely that scenario is. For probabilities, use the Monte Carlo tools.")

calc("monte_carlo", "Monte Carlo withdrawal test", RET,
     [F("bal", "Starting portfolio", "$", "2000000"), F("w", "First-year withdrawal", "$", "80000"),
      F("years", "Years", "years", "30", min=1, max=100, integer=True), F("mean", "Average annual return", "%", "6", min=-0.5),
      F("sd", "Volatility (standard deviation)", "%", "12", max=1), F("infl", "Withdrawal increase each year", "%", "2.5", min=-0.5),
      F("sims", "Number of simulations", "count", "2000", min=100, max=20000, default="2000"),
      F("seed", "Random seed", "count", "42", hint="Same seed gives the same result; change it to see a different draw.", default="42")],
     [O("0", "Success rate", "p_success", "percent"),
      O("1", "Ending balance: 10th percentile", "p_end_p10", "currency"),
      O("2", "Ending balance: median", "p_end_p50", "currency"),
      O("3", "Ending balance: 90th percentile", "p_end_p90", "currency")],
     "Each year: draw return ~ Normal(mean, sd); withdraw, then grow; success = every withdrawal fully met",
     "Simulates many market paths to estimate how often a withdrawal plan lasts.",
     "probability of success simulation sequence risk stochastic", common=True, projection="montecarlo",
     assumptions="Returns are independent, normally distributed annual draws. Real markets have fatter tails and streaks. Withdrawals happen at the start of each year and rise by the stated rate. Taxes and fees are excluded.",
     interpretation="A success rate summarizes simulated outcomes under the assumptions entered. It is not a probability forecast or a recommendation.",
     excelNotes="Simulation results aren't a cell formula. Use Copy table for the percentile paths.")

# --- Tax ---------------------------------------------------------------------
calc("income_tax", "Federal income tax", TX,
     [F("ti", "Taxable ordinary income", "$", "250000"), STATUS()],
     [O("0", "Federal tax", "incometax(ti,status)", "currency"),
      O("1", "Marginal rate", "margrate(ti,status)", "percent"),
      O("2", "Effective rate", "if(ti>0,incometax(ti,status)/ti,0)", "percent"),
      O("3", "Room left in this bracket", "bracketroom(ti,status)", "currency")],
     "Tax each slice of income at its bracket rate", "Ordinary federal income tax with marginal and effective rates.",
     "brackets marginal effective tax rate", interpretation=TAX_INTERP, sources=["brackets"], common=True,
     excelNotes="Bracket math needs a bracket table in Excel; the app uses its dated tax table.")

calc("taxable_income", "Taxable income from gross income", TX,
     [F("g", "Adjusted gross income", "$", "320000"), F("it", "Itemized deductions", "$", "28000"), STATUS()],
     [O("0", "Deduction used", "max(it,stddeduction(status))", "currency"),
      O("1", "Taxable income", "max(0,g-max(it,stddeduction(status)))", "currency"),
      O("2", "Federal tax on it", "incometax(max(0,g-max(it,stddeduction(status))),status)", "currency")],
     "AGI − larger of itemized or standard deduction", "Applies the larger of itemized or standard deduction.",
     "standard deduction itemize", interpretation=TAX_INTERP, sources=["brackets"])

calc("after_tax_return", "After-tax return", TX,
     [F("r", "Pre-tax return", "%", "6", min=-0.99), F("t", "Tax rate on the return", "%", "32", max=1)],
     [O("0", "After-tax return", "r*(1-t)", "percent", "={r}*(1-{t})")],
     "Return × (1 − tax rate)", "Return kept after tax, if the whole return is taxed each year.",
     "net of tax yield")

calc("tey", "Tax-equivalent yield", TX,
     [F("y", "Tax-free yield (municipal bond)", "%", "3.5"), F("t", "Combined marginal tax rate", "%", "37", max=0.99)],
     [O("0", "Taxable yield needed to match", "y/(1-t)", "percent", "={y}/(1-{t})")],
     "Tax-free yield ÷ (1 − tax rate)", "Taxable yield that leaves you with the same income as a tax-free bond.",
     "muni municipal bond tax free", acronym="TEY")

calc("ltcg_tax", "Long-term capital gains tax", TX,
     [F("ord", "Taxable ordinary income", "$", "180000"), F("gain", "Long-term gain / qualified dividends", "$", "100000"), STATUS()],
     [O("0", "Capital gains tax", "ltcgtax(ord,gain,status)", "currency"),
      O("1", "Effective rate on the gain", "if(gain>0,ltcgtax(ord,gain,status)/gain,0)", "percent")],
     "Gains stack on ordinary income through the 0% / 15% / 20% thresholds",
     "Federal tax on long-term gains and qualified dividends, layered on top of ordinary income.",
     "capital gains qualified dividends 15% 20%", interpretation=TAX_INTERP + " NIIT is a separate calculator.",
     sources=["capgains"])

calc("niit", "Net investment income tax", TX,
     [F("magi", "Modified AGI", "$", "320000"), F("nii", "Net investment income", "$", "90000"), STATUS()],
     [O("0", "NIIT", "niitrate()*min(nii,max(0,magi-niitthreshold(status)))", "currency"),
      O("1", "Amount over the threshold", "max(0,magi-niitthreshold(status))", "currency")],
     "3.8% × lesser of investment income or MAGI over the threshold",
     "Medicare surtax on investment income for higher earners.",
     "3.8% surtax medicare investment", acronym="NIIT", interpretation=TAX_INTERP, sources=["niit"])

calc("roth_vs_trad", "Roth vs. traditional contribution", TX,
     [F("c", "Pre-tax dollars available", "$", "10000"), F("tn", "Tax rate today", "%", "32", max=1),
      F("tr", "Tax rate in retirement", "%", "24", max=1), F("r", "Annual return", "%", "7", min=-0.99),
      F("n", "Years invested", "years", "25")],
     [O("0", "Traditional, after tax at withdrawal", "c*(1+r)^n*(1-tr)", "currency", "={c}*(1+{r})^{n}*(1-{tr})"),
      O("1", "Roth, after paying tax today", "c*(1-tn)*(1+r)^n", "currency", "={c}*(1-{tn})*(1+{r})^{n}"),
      O("2", "Roth minus traditional", "c*(1-tn)*(1+r)^n-c*(1+r)^n*(1-tr)", "currency",
        "={c}*(1-{tn})*(1+{r})^{n}-{c}*(1+{r})^{n}*(1-{tr})")],
     "Traditional: C × growth × (1 − future rate); Roth: C × (1 − today's rate) × growth",
     "Compares the after-tax result of the same pre-tax dollars in each account type.",
     "roth conversion traditional pretax", assumptions="Same return in both accounts; the whole traditional balance is taxed at one rate on withdrawal. Ignores RMDs, state tax and the value of investing the tax savings.")

calc("roth_conversion", "Roth conversion: tax and bracket room", TX,
     [F("ti", "Taxable income before conversion", "$", "150000"), F("x", "Amount to convert", "$", "50000"), STATUS()],
     [O("0", "Extra federal tax from conversion", "incometax(ti+x,status)-incometax(ti,status)", "currency"),
      O("1", "Average rate on the conversion", "if(x>0,(incometax(ti+x,status)-incometax(ti,status))/x,0)", "percent"),
      O("2", "Room left in current bracket", "bracketroom(ti,status)", "currency"),
      O("3", "Marginal rate after conversion", "margrate(ti+x,status)", "percent")],
     "Tax(income + conversion) − tax(income)", "Incremental tax from converting pre-tax money to Roth.",
     "fill the bracket conversion", interpretation=TAX_INTERP, sources=["brackets"])

calc("tlh", "Tax-loss harvesting value", TX,
     [F("loss", "Losses harvested", "$", "40000"), F("gains", "Capital gains this year", "$", "25000"),
      F("cg", "Capital gains tax rate", "%", "18.8", max=1), F("ord", "Ordinary income tax rate", "%", "32", max=1)],
     [O("0", "Tax saved this year", "min(loss,gains)*cg+min(3000,max(0,loss-gains))*ord", "currency",
        "=MIN({loss},{gains})*{cg}+MIN(3000,MAX(0,{loss}-{gains}))*{ord}"),
      O("1", "Loss carried forward", "max(0,loss-gains-3000)", "currency", "=MAX(0,{loss}-{gains}-3000)")],
     "Losses offset gains, then up to $3,000 of ordinary income; the rest carries forward",
     "Current-year tax value of realized losses.", "harvest losses offset carryforward",
     assumptions="All gains taxed at one rate; ignores the short/long-term netting order, wash-sale rules, and the lower basis that comes with harvesting ($1,500 ordinary offset if married filing separately).",
     sources=["capgains"])

calc("tax_deferral", "Tax-deferred vs. taxable growth", TX,
     [F("a", "Amount invested", "$", "100000"), F("r", "Annual return", "%", "7", min=-0.99),
      F("t", "Tax rate", "%", "24", max=1), F("n", "Years", "years", "20")],
     [O("0", "Taxable account (taxed yearly)", "a*(1+r*(1-t))^n", "currency", "={a}*(1+{r}*(1-{t}))^{n}"),
      O("1", "Deferred, gain taxed at the end", "a*(1+r)^n-(a*(1+r)^n-a)*t", "currency", "={a}*(1+{r})^{n}-({a}*(1+{r})^{n}-{a})*{t}"),
      O("2", "Benefit of deferral", "a*(1+r)^n-(a*(1+r)^n-a)*t-a*(1+r*(1-t))^n", "currency",
        "={a}*(1+{r})^{n}-({a}*(1+{r})^{n}-{a})*{t}-{a}*(1+{r}*(1-{t}))^{n}")],
     "Taxable: (1 + r(1−t))^n; Deferred: growth taxed once at the end",
     "Shows the cost of tax drag compared with deferring tax on the same after-tax principal.",
     "tax drag deferral annuity nonqualified")

# --- Portfolio & risk ------------------------------------------------------------
calc("weighted_return", "Portfolio expected return", PF,
     [F("w", "Weights or dollar amounts", "series", "60; 30; 10", min=None),
      F("r", "Expected return of each (%)", "series", "7; 4; 2", min=None, hint="Percentages, one per holding, same order: 7; 4; 2")],
     [O("0", "Weighted expected return", "sumproduct(w,r)/sum(w)/100", "percent")],
     "Σ(weight × return) ÷ Σ weight", "Blended expected return of an allocation.",
     "blended allocation return mix",
     rules=[R("count(w)", "==", "count(r)", "Enter the same number of weights and returns."),
            R("sum(w)", ">", "0", "Weights must add up to more than zero.")],
     excelNotes="Put weights in one row and returns in the next, then use =SUMPRODUCT(weights,returns)/SUM(weights).")

calc("two_asset", "Two-asset portfolio risk", PF,
     [F("w", "Weight in asset A", "%", "60", max=1), F("ra", "Expected return A", "%", "8", min=-0.99),
      F("rb", "Expected return B", "%", "4", min=-0.99), F("sa", "Volatility A", "%", "16"),
      F("sb", "Volatility B", "%", "6"), F("rho", "Correlation", "x", "0.1", min=-1, max=1, hint="Between −1 and 1.")],
     [O("0", "Expected return", "w*ra+(1-w)*rb", "percent", "={w}*{ra}+(1-{w})*{rb}"),
      O("1", "Portfolio volatility", "sqrt(w^2*sa^2+(1-w)^2*sb^2+2*w*(1-w)*rho*sa*sb)", "percent",
        "=SQRT({w}^2*{sa}^2+(1-{w})^2*{sb}^2+2*{w}*(1-{w})*{rho}*{sa}*{sb})")],
     "σp = √(w²σA² + (1−w)²σB² + 2w(1−w)ρσAσB)", "Return and volatility of a two-asset mix, including diversification.",
     "stock bond mix diversification correlation standard deviation")

calc("sharpe", "Sharpe ratio", PF,
     [F("r", "Portfolio return", "%", "9", min=-0.99), F("rf", "Risk-free rate", "%", "4", min=-0.1),
      F("sd", "Volatility (standard deviation)", "%", "14", min=0.0001)],
     [O("0", "Sharpe ratio", "(r-rf)/sd", "number", "=({r}-{rf})/{sd}")],
     "(Return − risk-free) ÷ volatility", "Excess return earned per unit of total risk.", "risk adjusted return")

calc("sortino", "Sortino ratio", PF,
     [F("r", "Portfolio return", "%", "9", min=-0.99), F("t", "Target / minimum return", "%", "3", min=-0.5),
      F("dd", "Downside deviation", "%", "8", min=0.0001)],
     [O("0", "Sortino ratio", "(r-t)/dd", "number", "=({r}-{t})/{dd}")],
     "(Return − target) ÷ downside deviation", "Excess return per unit of downside risk only.", "downside risk adjusted")

calc("capm", "CAPM expected return", PF,
     [F("rf", "Risk-free rate", "%", "4", min=-0.1), F("b", "Beta", "x", "1.2", min=-5), F("rm", "Expected market return", "%", "9", min=-0.99)],
     [O("0", "Expected return", "rf+b*(rm-rf)", "percent", "={rf}+{b}*({rm}-{rf})")],
     "Risk-free + beta × (market − risk-free)", "Required return given market sensitivity.", "beta capital asset pricing", acronym="CAPM")

calc("rebalance", "Rebalancing trade", PF,
     [F("v", "Total portfolio value", "$", "2000000", min=0.01), F("a", "Current value of the asset", "$", "1450000"),
      F("t", "Target weight", "%", "60", max=1)],
     [O("0", "Current weight", "a/v", "percent", "={a}/{v}"),
      O("1", "Drift from target", "a/v-t", "percent", "={a}/{v}-{t}"),
      O("2", "Buy (+) / sell (−) to reach target", "v*t-a", "currency", "={v}*{t}-{a}")],
     "Target value − current value", "Trade that brings one holding back to its target weight.",
     "drift allocation rebalance trade", common=True,
     rules=[R("a", "<=", "v", "Asset value can't exceed the total portfolio.")])

calc("drawdown", "Loss recovery", PF,
     [F("l", "Decline", "%", "30", max=0.9999), F("r", "Expected annual return", "%", "7", min=0.0001)],
     [O("0", "Gain needed to recover", "1/(1-l)-1", "percent", "=1/(1-{l})-1"),
      O("1", "Years to recover at that return", "ln(1/(1-l))/ln(1+r)", "years", "=LN(1/(1-{l}))/LN(1+{r})")],
     "1 ÷ (1 − loss) − 1", "Gain needed to get back to even after a drawdown.", "drawdown bear market recovery")

calc("hpr", "Holding-period return", PF,
     [F("b", "Beginning value", "$", "100000", min=0.01), F("e", "Ending value", "$", "118000"),
      F("i", "Income received (dividends, interest)", "$", "3000"), F("n", "Years held", "years", "2", min=0.01)],
     [O("0", "Total return", "(e+i-b)/b", "percent", "=({e}+{i}-{b})/{b}"),
      O("1", "Annualized", "((e+i)/b)^(1/n)-1", "percent", "=(({e}+{i})/{b})^(1/{n})-1")],
     "(End + income − begin) ÷ begin", "Total and annualized return including income.", "total return annualized")

calc("irr", "Money-weighted return (IRR)", PF,
     [F("cf", "Cash flows by period", "series", "-100000; -20000; 5000; 8000; 160000", min=None,
        hint="Negative = money in, positive = money out. Last value includes the ending balance.")],
     [O("0", "Return per period", "irr(cf)", "percent", "=IRR({cf})")],
     "Rate where the net present value of the cash flows is zero",
     "Return that accounts for the timing and size of deposits and withdrawals.",
     "internal rate of return money weighted dollar weighted", acronym="IRR",
     rules=[R("count(cf)", ">=", "2", "Enter at least two cash flows.")])

calc("dca", "Dollar-cost averaging", PF,
     [F("a", "Amount invested each time", "series", "1000; 1000; 1000; 1000", min=None),
      F("p", "Price each time", "series", "50; 40; 45; 55", min=None)],
     [O("0", "Shares bought", "sum(a/p)", "number"),
      O("1", "Average cost per share", "sum(a)/sum(a/p)", "currency"),
      O("2", "Simple average price", "avg(p)", "currency")],
     "Total invested ÷ total shares", "Average cost from investing on a schedule, compared with the average price.",
     "dca average cost basis periodic",
     rules=[R("count(a)", "==", "count(p)", "Enter the same number of amounts and prices.")],
     excelNotes="With amounts in one row and prices in the next: =SUM(amounts)/SUMPRODUCT(amounts/prices).")

# --- Fees & costs ----------------------------------------------------------------
calc("fee_drag", "Cost of fees over time", FEE,
     [F("a", "Amount invested", "$", "1000000"), F("r", "Return before fees", "%", "7", min=-0.99),
      F("f", "Annual fee", "%", "1", max=0.2), F("n", "Years", "years", "25")],
     [O("0", "Value with no fee", "a*(1+r)^n", "currency", "={a}*(1+{r})^{n}"),
      O("1", "Value after fees", "a*(1+r-f)^n", "currency", "={a}*(1+{r}-{f})^{n}"),
      O("2", "Cost of fees", "a*(1+r)^n-a*(1+r-f)^n", "currency", "={a}*(1+{r})^{n}-{a}*(1+{r}-{f})^{n}"),
      O("3", "Share of ending value lost", "1-((1+r-f)/(1+r))^n", "percent", "=1-((1+{r}-{f})/(1+{r}))^{n}")],
     "Amount × (1 + r)^n − amount × (1 + r − fee)^n",
     "Total cost of an annual fee, including the growth the fee money would have earned.",
     "advisory fee expense ratio drag compounding cost", sources=["fees"], common=True)

calc("fee_compare", "Compare two fee levels", FEE,
     [F("a", "Amount invested", "$", "500000"), F("r", "Return before fees", "%", "7", min=-0.99),
      F("f1", "Fee option A", "%", "1.0", max=0.2), F("f2", "Fee option B", "%", "0.25", max=0.2),
      F("n", "Years", "years", "20")],
     [O("0", "Ending value, A", "a*(1+r-f1)^n", "currency", "={a}*(1+{r}-{f1})^{n}"),
      O("1", "Ending value, B", "a*(1+r-f2)^n", "currency", "={a}*(1+{r}-{f2})^{n}"),
      O("2", "Difference (B − A)", "a*(1+r-f2)^n-a*(1+r-f1)^n", "currency", "={a}*(1+{r}-{f2})^{n}-{a}*(1+{r}-{f1})^{n}")],
     "Same growth, net of each fee", "Ending-value gap between two fee levels.", "expense ratio fund comparison",
     sources=["fees"])

calc("aum_vs_flat", "AUM fee vs. flat fee", FEE,
     [F("v", "Assets under management", "$", "2500000"), F("f", "AUM fee", "%", "0.9", max=0.1, min=0.00001),
      F("flat", "Flat annual fee", "$", "12000")],
     [O("0", "AUM fee per year", "v*f", "currency", "={v}*{f}"),
      O("1", "AUM minus flat fee", "v*f-flat", "currency", "={v}*{f}-{flat}"),
      O("2", "Asset level where they're equal", "flat/f", "currency", "={flat}/{f}"),
      O("3", "Flat fee as % of assets", "flat/v", "percent", "={flat}/{v}")],
     "Assets × AUM rate vs. flat fee", "Compares a percentage-of-assets fee with a fixed fee.",
     "advisor fee assets under management retainer", acronym="AUM")

calc("tiered_fee", "Tiered (breakpoint) advisory fee", FEE,
     [F("v", "Assets", "$", "3000000"), F("b1", "Tier 1 up to", "$", "1000000"), F("f1", "Tier 1 rate", "%", "1.0", max=0.1),
      F("b2", "Tier 2 up to", "$", "5000000"), F("f2", "Tier 2 rate", "%", "0.75", max=0.1), F("f3", "Rate above tier 2", "%", "0.5", max=0.1)],
     [O("0", "Annual fee", "min(v,b1)*f1+max(0,min(v,b2)-b1)*f2+max(0,v-b2)*f3", "currency",
        "=MIN({v},{b1})*{f1}+MAX(0,MIN({v},{b2})-{b1})*{f2}+MAX(0,{v}-{b2})*{f3}"),
      O("1", "Blended rate", "(min(v,b1)*f1+max(0,min(v,b2)-b1)*f2+max(0,v-b2)*f3)/v", "percent",
        "=(MIN({v},{b1})*{f1}+MAX(0,MIN({v},{b2})-{b1})*{f2}+MAX(0,{v}-{b2})*{f3})/{v}")],
     "Each slice of assets at its tier's rate", "Fee and blended rate on a breakpoint schedule.",
     "breakpoints blended fee schedule",
     rules=[R("b2", ">", "b1", "Tier 2 must end above tier 1."), R("v", ">", "0", "Assets must be greater than zero.")])

calc("front_load", "Sales load", FEE,
     [F("a", "Amount paid", "$", "100000"), F("l", "Front-end load", "%", "5.75", max=0.2)],
     [O("0", "Amount actually invested", "a*(1-l)", "currency", "={a}*(1-{l})"),
      O("1", "Load paid", "a*l", "currency", "={a}*{l}"),
      O("2", "Gain needed to break even", "1/(1-l)-1", "percent", "=1/(1-{l})-1")],
     "Amount × (1 − load)", "What a front-end sales charge takes off the top.", "mutual fund class a load commission",
     sources=["fees"])

# --- Stocks & bonds ----------------------------------------------------------------
FREQ = [{"value": 1, "label": "Annual"}, {"value": 2, "label": "Semiannual"},
        {"value": 4, "label": "Quarterly"}, {"value": 12, "label": "Monthly"}]
BOND_ASSUMPTIONS = ("Priced on a coupon date (no accrued interest), fixed coupons, held to maturity, every payment "
                    "made in full. Ignores call features, taxes and transaction costs.")

calc("bond_price", "Bond price from yield", SB,
     [F("face", "Face value", "$", "1000", min=0.01), F("cpn", "Coupon rate", "%", "4.5"),
      F("ytm", "Yield to maturity", "%", "5", min=-0.5), F("years", "Years to maturity", "years", "10", min=0.01),
      F("freq", "Coupon payments", "choice", "2", options=FREQ)],
     [O("0", "Price", "bondprice(face,cpn,ytm,years,freq)", "currency",
        "=PV({ytm}/{freq},ROUND({years}*{freq},0),-{face}*{cpn}/{freq},-{face})"),
      O("1", "Price as % of face", "bondprice(face,cpn,ytm,years,freq)/face", "percent",
        "=PV({ytm}/{freq},ROUND({years}*{freq},0),-{face}*{cpn}/{freq},-{face})/{face}"),
      O("2", "Current yield", "face*cpn/bondprice(face,cpn,ytm,years,freq)", "percent",
        "={face}*{cpn}/PV({ytm}/{freq},ROUND({years}*{freq},0),-{face}*{cpn}/{freq},-{face})"),
      O("3", "Premium (+) / discount (−) to face", "bondprice(face,cpn,ytm,years,freq)-face", "currency",
        "=PV({ytm}/{freq},ROUND({years}*{freq},0),-{face}*{cpn}/{freq},-{face})-{face}")],
     "Coupon × (1 − (1+i)^−n) ÷ i + face × (1+i)^−n, with i = yield ÷ payments per year",
     "What a fixed-rate bond is worth at a given market yield.",
     "bond pricing treasury corporate muni coupon present value", common=True,
     assumptions=BOND_ASSUMPTIONS, sources=["bonds", "treasury"],
     rules=[R("years*freq", ">=", "0.5", "Maturity must be at least one coupon period.")])

calc("bond_ytm", "Yield to maturity from price", SB,
     [F("price", "Price paid", "$", "960", min=0.01), F("face", "Face value", "$", "1000", min=0.01),
      F("cpn", "Coupon rate", "%", "4"), F("years", "Years to maturity", "years", "7", min=0.01),
      F("freq", "Coupon payments", "choice", "2", options=FREQ)],
     [O("0", "Yield to maturity", "bondytm(price,face,cpn,years,freq)", "percent",
        "=RATE(ROUND({years}*{freq},0),{face}*{cpn}/{freq},-{price},{face})*{freq}"),
      O("1", "Current yield", "face*cpn/price", "percent", "={face}*{cpn}/{price}")],
     "Yield at which the bond's cash flows are worth exactly the price",
     "Annual return from buying a bond at a price and holding it to maturity.",
     "ytm bond yield return price discount premium", acronym="YTM",
     assumptions=BOND_ASSUMPTIONS + " YTM assumes coupons are reinvested at the same yield.", sources=["bonds"],
     rules=[R("years*freq", ">=", "0.5", "Maturity must be at least one coupon period.")])

calc("bond_duration", "Duration & rate shock", SB,
     [F("face", "Face value", "$", "1000", min=0.01), F("cpn", "Coupon rate", "%", "4.5"),
      F("ytm", "Yield to maturity", "%", "5", min=-0.5), F("years", "Years to maturity", "years", "10", min=0.01),
      F("freq", "Coupon payments", "choice", "2", options=FREQ),
      F("dy", "Change in yield", "%", "1", min=-0.1, max=0.1, hint="Enter 1 for +1% (100 bp), −0.5 for −0.5%.")],
     [O("0", "Macaulay duration", "macdur(face,cpn,ytm,years,freq)", "years"),
      O("1", "Modified duration", "macdur(face,cpn,ytm,years,freq)/(1+ytm/freq)", "years",
        "=MDURATION(DATE(2000,1,1),EDATE(DATE(2000,1,1),12*{years}),{cpn},{ytm},{freq})"),
      O("2", "Convexity", "bondconvexity(face,cpn,ytm,years,freq)", "number"),
      O("3", "Estimated price change", "-macdur(face,cpn,ytm,years,freq)/(1+ytm/freq)*dy+0.5*bondconvexity(face,cpn,ytm,years,freq)*dy^2", "percent"),
      O("4", "Exact price change", "bondprice(face,cpn,ytm+dy,years,freq)/bondprice(face,cpn,ytm,years,freq)-1", "percent")],
     "ΔP/P ≈ −modified duration × Δy + ½ × convexity × Δy²",
     "How sensitive a bond's price is to interest-rate moves, with an estimate and the exact repriced change.",
     "interest rate risk sensitivity duration convexity basis points", assumptions=BOND_ASSUMPTIONS, sources=["bonds"],
     rules=[R("years*freq", ">=", "0.5", "Maturity must be at least one coupon period."),
            R("ytm+dy", ">", "-0.5", "The shocked yield is too low.")],
     excelNotes="MDURATION needs settlement and maturity dates; the formula uses placeholder dates spanning the maturity.")

calc("tbill", "Treasury bill yields", SB,
     [F("face", "Face value", "$", "10000", min=0.01), F("price", "Purchase price", "$", "9890", min=0.01),
      F("days", "Days to maturity", "count", "91", min=1, max=366)],
     [O("0", "Bank discount yield", "(face-price)/face*360/days", "percent", "=({face}-{price})/{face}*360/{days}"),
      O("1", "Bond-equivalent yield", "(face-price)/price*365/days", "percent", "=({face}-{price})/{price}*365/{days}"),
      O("2", "Money-market yield", "(face-price)/price*360/days", "percent", "=({face}-{price})/{price}*360/{days}"),
      O("3", "Interest earned", "face-price", "currency", "={face}-{price}")],
     "Discount ÷ face × 360 ÷ days; BEY = discount ÷ price × 365 ÷ days",
     "Converts a T-bill price into the different yield conventions quoted in the market.",
     "t-bill treasury bill discount yield bey cash", sources=["tbills"],
     rules=[R("price", "<", "face", "Price must be below face value for a discount bill.")],
     assumptions="Simple-interest yields for bills of a year or less, held to maturity. Treasury interest is exempt from state income tax.")

calc("stock_valuation", "Dividend yield, P/E & payout", SB,
     [F("price", "Share price", "$", "185", min=0.01), F("div", "Annual dividend per share", "$", "3.40"),
      F("eps", "Earnings per share (trailing 12 months)", "$", "9.25", min=None)],
     [O("0", "Dividend yield", "div/price", "percent", "={div}/{price}"),
      O("1", "Price / earnings (P/E)", "if(eps>0,price/eps,nan())", "multiple", "={price}/{eps}"),
      O("2", "Earnings yield", "eps/price", "percent", "={eps}/{price}"),
      O("3", "Payout ratio", "if(eps>0,div/eps,nan())", "percent", "={div}/{eps}")],
     "Dividend ÷ price; price ÷ EPS; dividend ÷ EPS",
     "Core per-share valuation ratios for a stock.", "pe ratio valuation dividend yield payout earnings", acronym="P/E",
     interpretation="Ratios describe the current price relative to past results. P/E and payout aren't meaningful when earnings are zero or negative (shown as n/a).")

calc("position_pl", "Position gain/loss", SB,
     [F("shares", "Shares owned", "x", "250", min=0, hint="Number of shares; fractions OK."),
      F("cost", "Average cost per share", "$", "142", min=0.0001), F("price", "Current price", "$", "185"),
      F("divs", "Dividends received (total)", "$", "1600"), F("years", "Years held", "years", "3.5", min=0.01)],
     [O("0", "Market value", "shares*price", "currency", "={shares}*{price}"),
      O("1", "Unrealized gain/loss", "shares*(price-cost)", "currency", "={shares}*({price}-{cost})"),
      O("2", "Total return incl. dividends", "(shares*price+divs)/(shares*cost)-1", "percent",
        "=({shares}*{price}+{divs})/({shares}*{cost})-1"),
      O("3", "Annualized total return", "((shares*price+divs)/(shares*cost))^(1/years)-1", "percent",
        "=(({shares}*{price}+{divs})/({shares}*{cost}))^(1/{years})-1")],
     "Gain = shares × (price − cost); total return adds dividends received",
     "Value, gain and annualized return on a stock or fund position.", "unrealized gain cost basis holding return portfolio",
     common=True, rules=[R("shares", ">", "0", "Enter a number of shares above zero.")],
     assumptions="Dividends are counted as cash received, not reinvested. Ignores taxes and trading costs.")

calc("dividend_income", "Dividend income growth", SB,
     [F("amt", "Amount invested", "$", "250000"), F("y", "Starting dividend yield", "%", "3.2"),
      F("g", "Annual dividend growth", "%", "6", min=-0.5), F("n", "Years", "years", "15", min=1)],
     [O("0", "Income in year one", "amt*y", "currency", "={amt}*{y}"),
      O("1", "Income in final year", "amt*y*(1+g)^(n-1)", "currency", "={amt}*{y}*(1+{g})^({n}-1)"),
      O("2", "Total income over the period", "if(g==0,amt*y*n,amt*y*((1+g)^n-1)/g)", "currency",
        "=IF({g}=0,{amt}*{y}*{n},{amt}*{y}*((1+{g})^{n}-1)/{g})"),
      O("3", "Yield on original cost in final year", "y*(1+g)^(n-1)", "percent", "={y}*(1+{g})^({n}-1)")],
     "Year-k income = amount × yield × (1 + growth)^(k−1)",
     "Projects the income from a dividend portfolio whose payouts grow, without reinvesting.",
     "dividend growth income yield on cost", assumptions="Dividends are spent, not reinvested, and grow at a steady rate. Dividends can be cut.")

calc("ddm", "Dividend discount model", SB,
     [F("d0", "Current annual dividend", "$", "3.40"), F("g", "Long-run dividend growth", "%", "5", min=-0.5),
      F("r", "Required return", "%", "9", min=0.0001), F("price", "Current price (optional compare)", "$", "185")],
     [O("0", "Next year's dividend", "d0*(1+g)", "currency", "={d0}*(1+{g})"),
      O("1", "Fair value", "d0*(1+g)/(r-g)", "currency", "={d0}*(1+{g})/({r}-{g})"),
      O("2", "Price ÷ fair value", "price/(d0*(1+g)/(r-g))", "percent", "={price}/({d0}*(1+{g})/({r}-{g}))"),
      O("3", "Return implied by today's price", "d0*(1+g)/price+g", "percent", "={d0}*(1+{g})/{price}+{g}")],
     "Value = next dividend ÷ (required return − growth)",
     "Gordon growth model: values a stock from a dividend that grows forever at a steady rate.",
     "gordon growth intrinsic value dividend discount", acronym="DDM",
     rules=[R("r", ">", "g", "Required return must exceed growth.")],
     interpretation="Highly sensitive to the growth and return inputs. Small changes move the value a lot. It's a framework, not a price target.")

calc("position_size", "Position sizing", SB,
     [F("v", "Portfolio value", "$", "800000", min=0.01), F("w", "Target weight", "%", "5", max=1),
      F("price", "Share price", "$", "185", min=0.01), F("held", "Shares already owned", "x", "0", hint="Number of shares.")],
     [O("0", "Target dollar amount", "v*w", "currency", "={v}*{w}"),
      O("1", "Whole shares at target", "floor(v*w/price)", "number", "=ROUNDDOWN({v}*{w}/{price},0)"),
      O("2", "Shares to buy (+) / sell (−)", "floor(v*w/price)-held", "number", "=ROUNDDOWN({v}*{w}/{price},0)-{held}"),
      O("3", "Cost of the trade", "(floor(v*w/price)-held)*price", "currency", "=(ROUNDDOWN({v}*{w}/{price},0)-{held})*{price}")],
     "Whole shares = floor(portfolio × weight ÷ price)",
     "How many shares make up a target weight, and the trade to get there.", "how many shares buy allocation weight")

# --- Statistics & econometrics -----------------------------------------------------
STAT_ASSUME = "Observations are independent draws from the population. Sample statistics use n − 1."
CONF = lambda ex="95": F("c", "Confidence level", "%", ex, min=0.5, max=0.9999)
XS = "2.1; 3.4; 2.9; 4.2; 3.8; 3.1; 2.7; 3.9; 3.3; 4.6"
RX = "1; 2; 3; 4; 5; 6; 7; 8; 9; 10"
RY = "3.1; 4.9; 7.2; 8.8; 11.1; 12.7; 15.2; 16.8; 19.3; 20.9"
REG = "(cov(x,y)/var(x))"
INT = "(avg(y)-cov(x,y)/var(x)*avg(x))"
SSR = "sum((y-" + INT + "-" + REG + "*x)^2)"
SXX = "sum((x-avg(x))^2)"
SE_B = "sqrt(" + SSR + "/(count(x)-2)/" + SXX + ")"

calc("descriptive", "Descriptive statistics", ST,
     [F("x", "Data", "series", XS, min=None, hint="Separate values with semicolons or new lines, or paste a column from Excel.")],
     [O("0", "Count (n)", "count(x)", "number", "=COUNT({x})"),
      O("1", "Mean", "avg(x)", "number", "=AVERAGE({x})"),
      O("2", "Median", "median(x)", "number", "=MEDIAN({x})"),
      O("3", "Standard deviation (sample)", "sd(x)", "number", "=STDEV.S({x})"),
      O("4", "Variance (sample)", "var(x)", "number", "=VAR.S({x})"),
      O("5", "Standard error of the mean", "sd(x)/sqrt(count(x))", "number", "=STDEV.S({x})/SQRT(COUNT({x}))"),
      O("6", "Minimum", "min(x)", "number", "=MIN({x})"),
      O("7", "Maximum", "max(x)", "number", "=MAX({x})"),
      O("8", "Coefficient of variation", "sd(x)/avg(x)", "percent", "=STDEV.S({x})/AVERAGE({x})")],
     "Mean = Σx ÷ n; s = √(Σ(x − x̄)² ÷ (n − 1))", "Summary statistics for a list of numbers.",
     "mean median mode standard deviation variance summary stats average", common=True,
     rules=[R("count(x)", ">=", "2", "Enter at least two values.")], assumptions=STAT_ASSUME, sources=["openstax_stats"])

calc("normal_prob", "Normal probability & z-score", ST,
     [F("v", "Value (x)", "x", "130", min=None), F("m", "Mean (μ)", "x", "100", min=None),
      F("s", "Standard deviation (σ)", "x", "15", min=0.0000001)],
     [O("0", "z-score", "(v-m)/s", "number", "=STANDARDIZE({v},{m},{s})"),
      O("1", "P(X < x)", "normcdf((v-m)/s)", "percent", "=NORM.DIST({v},{m},{s},TRUE)"),
      O("2", "P(X > x)", "1-normcdf((v-m)/s)", "percent", "=1-NORM.DIST({v},{m},{s},TRUE)"),
      O("3", "P(|Z| > |z|), two-tailed", "2*(1-normcdf(abs((v-m)/s)))", "percent", "=2*(1-NORM.S.DIST(ABS(STANDARDIZE({v},{m},{s})),TRUE))")],
     "z = (x − μ) ÷ σ; P from the standard normal CDF", "Converts a value to a z-score and finds normal-curve probabilities.",
     "z score normal distribution bell curve probability percentile", sources=["nist"])

calc("normal_between", "Normal probability between two values", ST,
     [F("a", "Lower value", "x", "85", min=None), F("b", "Upper value", "x", "115", min=None),
      F("m", "Mean (μ)", "x", "100", min=None), F("s", "Standard deviation (σ)", "x", "15", min=0.0000001)],
     [O("0", "P(a < X < b)", "normcdf((b-m)/s)-normcdf((a-m)/s)", "percent", "=NORM.DIST({b},{m},{s},TRUE)-NORM.DIST({a},{m},{s},TRUE)"),
      O("1", "Outside the range", "1-(normcdf((b-m)/s)-normcdf((a-m)/s))", "percent", "=1-(NORM.DIST({b},{m},{s},TRUE)-NORM.DIST({a},{m},{s},TRUE))")],
     "Φ((b − μ)/σ) − Φ((a − μ)/σ)", "Probability a normal variable falls between two values.",
     "normal range between probability empirical rule 68 95", rules=[R("b", ">", "a", "Upper value must exceed lower value.")])

calc("inverse_normal", "Critical values (z and t)", ST,
     [CONF(), F("df", "Degrees of freedom (for t)", "count", "20", min=1)],
     [O("0", "z* (two-tailed)", "norminv(1-(1-c)/2)", "number", "=NORM.S.INV(1-(1-{c})/2)"),
      O("1", "t* (two-tailed)", "tinv(1-(1-c)/2,df)", "number", "=T.INV.2T(1-{c},{df})"),
      O("2", "z* (one-tailed)", "norminv(c)", "number", "=NORM.S.INV({c})"),
      O("3", "t* (one-tailed)", "tinv(c,df)", "number", "=T.INV({c},{df})")],
     "z* = Φ⁻¹(1 − α/2); t* = t⁻¹(1 − α/2, df)", "Critical values for confidence intervals and hypothesis tests.",
     "critical value z table t table alpha significance level inverse", sources=["nist"])

calc("pvalue", "p-value from a test statistic", ST,
     [F("stat", "Test statistic (z or t)", "x", "2.31", min=None), F("df", "Degrees of freedom (t test)", "count", "24", min=1)],
     [O("0", "Two-tailed p (t)", "2*(1-tcdf(abs(stat),df))", "percent", "=T.DIST.2T(ABS({stat}),{df})"),
      O("1", "One-tailed p (t, upper)", "1-tcdf(stat,df)", "percent", "=T.DIST.RT({stat},{df})"),
      O("2", "Two-tailed p (z)", "2*(1-normcdf(abs(stat)))", "percent", "=2*(1-NORM.S.DIST(ABS({stat}),TRUE))"),
      O("3", "One-tailed p (z, upper)", "1-normcdf(stat)", "percent", "=1-NORM.S.DIST({stat},TRUE)")],
     "p = P(|T| ≥ |t|) from the t or standard normal distribution",
     "Probability of a statistic at least this extreme if the null hypothesis is true.",
     "p value hypothesis test significance reject null", sources=["nist"],
     interpretation="Compare p with your significance level (often 5%). A small p is evidence against the null; it isn't the probability the null is true.")

calc("ci_mean_data", "Confidence interval for a mean (data)", ST,
     [F("x", "Data", "series", XS, min=None), CONF()],
     [O("0", "Mean", "avg(x)", "number", "=AVERAGE({x})"),
      O("1", "Margin of error", "tinv(1-(1-c)/2,count(x)-1)*sd(x)/sqrt(count(x))", "number", "=CONFIDENCE.T(1-{c},STDEV.S({x}),COUNT({x}))"),
      O("2", "Lower bound", "avg(x)-tinv(1-(1-c)/2,count(x)-1)*sd(x)/sqrt(count(x))", "number", "=AVERAGE({x})-CONFIDENCE.T(1-{c},STDEV.S({x}),COUNT({x}))"),
      O("3", "Upper bound", "avg(x)+tinv(1-(1-c)/2,count(x)-1)*sd(x)/sqrt(count(x))", "number", "=AVERAGE({x})+CONFIDENCE.T(1-{c},STDEV.S({x}),COUNT({x}))")],
     "x̄ ± t* × s ÷ √n", "t-based confidence interval for a population mean from raw data.",
     "confidence interval mean t interval margin of error", assumptions=STAT_ASSUME + " Population roughly normal or n large.",
     rules=[R("count(x)", ">=", "2", "Enter at least two values.")], sources=["openstax_stats"])

calc("ci_mean_summary", "Confidence interval for a mean (summary)", ST,
     [F("m", "Sample mean", "x", "52.3", min=None), F("s", "Sample standard deviation", "x", "8.1", min=0.0000001),
      F("n", "Sample size", "count", "36", min=2), CONF()],
     [O("0", "Margin of error", "tinv(1-(1-c)/2,n-1)*s/sqrt(n)", "number", "=CONFIDENCE.T(1-{c},{s},{n})"),
      O("1", "Lower bound", "m-tinv(1-(1-c)/2,n-1)*s/sqrt(n)", "number", "={m}-CONFIDENCE.T(1-{c},{s},{n})"),
      O("2", "Upper bound", "m+tinv(1-(1-c)/2,n-1)*s/sqrt(n)", "number", "={m}+CONFIDENCE.T(1-{c},{s},{n})"),
      O("3", "Standard error", "s/sqrt(n)", "number", "={s}/SQRT({n})")],
     "x̄ ± t* × s ÷ √n", "Confidence interval for a mean from summary statistics.",
     "confidence interval mean summary statistics", assumptions=STAT_ASSUME, sources=["openstax_stats"])

calc("ci_proportion", "Confidence interval for a proportion", ST,
     [F("k", "Successes", "count", "312", min=0), F("n", "Sample size", "count", "600", min=1), CONF()],
     [O("0", "Sample proportion", "k/n", "percent", "={k}/{n}"),
      O("1", "Margin of error", "norminv(1-(1-c)/2)*sqrt(k/n*(1-k/n)/n)", "percent", "=NORM.S.INV(1-(1-{c})/2)*SQRT({k}/{n}*(1-{k}/{n})/{n})"),
      O("2", "Lower bound", "k/n-norminv(1-(1-c)/2)*sqrt(k/n*(1-k/n)/n)", "percent", "={k}/{n}-NORM.S.INV(1-(1-{c})/2)*SQRT({k}/{n}*(1-{k}/{n})/{n})"),
      O("3", "Upper bound", "k/n+norminv(1-(1-c)/2)*sqrt(k/n*(1-k/n)/n)", "percent", "={k}/{n}+NORM.S.INV(1-(1-{c})/2)*SQRT({k}/{n}*(1-{k}/{n})/{n})")],
     "p̂ ± z* × √(p̂(1 − p̂) ÷ n)", "Wald confidence interval for a population proportion (polls, survey shares).",
     "proportion poll survey margin of error percent", rules=[R("k", "<=", "n", "Successes can't exceed the sample size.")],
     assumptions="Wald interval; reasonable when n·p̂ and n·(1 − p̂) are both at least 10.", sources=["openstax_stats"])

calc("sample_size", "Sample size needed", ST,
     [CONF(), F("s", "Expected standard deviation (for a mean)", "x", "15", min=0.0000001),
      F("e", "Margin of error for the mean", "x", "2", min=0.0000001),
      F("p", "Expected proportion", "%", "50", max=1), F("ep", "Margin of error for a proportion", "%", "3", min=0.0001, max=1)],
     [O("0", "n for a mean", "ceil((norminv(1-(1-c)/2)*s/e)^2)", "number", "=ROUNDUP((NORM.S.INV(1-(1-{c})/2)*{s}/{e})^2,0)"),
      O("1", "n for a proportion", "ceil(norminv(1-(1-c)/2)^2*p*(1-p)/ep^2)", "number", "=ROUNDUP(NORM.S.INV(1-(1-{c})/2)^2*{p}*(1-{p})/{ep}^2,0)")],
     "n = (z* σ ÷ E)²; n = z*² p(1 − p) ÷ E²", "Minimum sample size to hit a target margin of error.",
     "sample size survey design how many respondents", sources=["openstax_stats"],
     assumptions="Uses z (large-sample) critical values and simple random sampling. Use 50% for the proportion when unsure: it's the most conservative.")

calc("t_test_one", "One-sample t-test", ST,
     [F("x", "Data", "series", XS, min=None), F("mu", "Hypothesized mean (μ₀)", "x", "3", min=None)],
     [O("0", "t statistic", "(avg(x)-mu)/(sd(x)/sqrt(count(x)))", "number", "=(AVERAGE({x})-{mu})/(STDEV.S({x})/SQRT(COUNT({x})))"),
      O("1", "Degrees of freedom", "count(x)-1", "number", "=COUNT({x})-1"),
      O("2", "p-value (two-tailed)", "2*(1-tcdf(abs((avg(x)-mu)/(sd(x)/sqrt(count(x)))),count(x)-1))", "percent",
        "=T.DIST.2T(ABS((AVERAGE({x})-{mu})/(STDEV.S({x})/SQRT(COUNT({x})))),COUNT({x})-1)")],
     "t = (x̄ − μ₀) ÷ (s ÷ √n), df = n − 1", "Tests whether a sample mean differs from a hypothesized value.",
     "hypothesis test one sample mean t test", assumptions=STAT_ASSUME + " Population roughly normal or n large.",
     rules=[R("count(x)", ">=", "2", "Enter at least two values.")], sources=["nist"])

calc("t_test_two", "Two-sample t-test (Welch)", ST,
     [F("x", "Group 1 data", "series", "23; 25; 28; 30; 26; 27; 24; 29", min=None),
      F("y", "Group 2 data", "series", "20; 22; 25; 21; 24; 23; 19; 22; 21", min=None)],
     [O("0", "Difference in means (1 − 2)", "avg(x)-avg(y)", "number", "=AVERAGE({x})-AVERAGE({y})"),
      O("1", "t statistic", "(avg(x)-avg(y))/sqrt(var(x)/count(x)+var(y)/count(y))", "number"),
      O("2", "Degrees of freedom (Welch)", "(var(x)/count(x)+var(y)/count(y))^2/((var(x)/count(x))^2/(count(x)-1)+(var(y)/count(y))^2/(count(y)-1))", "number"),
      O("3", "p-value (two-tailed)", "2*(1-tcdf(abs((avg(x)-avg(y))/sqrt(var(x)/count(x)+var(y)/count(y))),(var(x)/count(x)+var(y)/count(y))^2/((var(x)/count(x))^2/(count(x)-1)+(var(y)/count(y))^2/(count(y)-1))))", "percent",
        "=T.TEST({x},{y},2,3)")],
     "t = (x̄₁ − x̄₂) ÷ √(s₁²/n₁ + s₂²/n₂), Welch–Satterthwaite df",
     "Tests whether two groups have different means without assuming equal variances.",
     "two sample t test difference in means welch independent groups treatment control",
     rules=[R("count(x)", ">=", "2", "Group 1 needs at least two values."), R("count(y)", ">=", "2", "Group 2 needs at least two values.")],
     assumptions="Independent samples; each roughly normal or large.", sources=["nist"],
     excelNotes="Excel's T.TEST(…,2,3) returns the Welch two-tailed p-value directly; its df may differ slightly because Excel rounds it.")

calc("correlation", "Correlation", ST,
     [F("x", "X values", "series", RX, min=None), F("y", "Y values", "series", RY, min=None)],
     [O("0", "Correlation (r)", "corr(x,y)", "number", "=CORREL({x},{y})"),
      O("1", "R²", "corr(x,y)^2", "percent", "=RSQ({y},{x})"),
      O("2", "Covariance (sample)", "cov(x,y)", "number", "=COVARIANCE.S({x},{y})"),
      O("3", "p-value for r ≠ 0", "2*(1-tcdf(abs(corr(x,y)*sqrt((count(x)-2)/(1-corr(x,y)^2))),count(x)-2))", "percent")],
     "r = cov(x, y) ÷ (sₓ s_y); t = r √((n − 2) ÷ (1 − r²))", "Pearson correlation between two variables and its significance.",
     "pearson correlation coefficient covariance relationship",
     rules=[R("count(x)", "==", "count(y)", "Enter the same number of X and Y values."), R("count(x)", ">=", "3", "Enter at least three pairs.")],
     sources=["nist"])

calc("ols", "Simple linear regression (OLS)", ST,
     [F("x", "X (independent)", "series", RX, min=None), F("y", "Y (dependent)", "series", RY, min=None)],
     [O("0", "Slope (β₁)", REG, "number", "=SLOPE({y},{x})"),
      O("1", "Intercept (β₀)", INT, "number", "=INTERCEPT({y},{x})"),
      O("2", "R²", "corr(x,y)^2", "percent", "=RSQ({y},{x})"),
      O("3", "Std. error of slope", SE_B, "number", "=INDEX(LINEST({y},{x},TRUE,TRUE),2,1)"),
      O("4", "t statistic (slope)", REG + "/" + SE_B, "number"),
      O("5", "p-value (slope)", "2*(1-tcdf(abs(" + REG + "/" + SE_B + "),count(x)-2))", "percent"),
      O("6", "Residual std. error", "sqrt(" + SSR + "/(count(x)-2))", "number", "=STEYX({y},{x})")],
     "β₁ = cov(x, y) ÷ var(x); β₀ = ȳ − β₁x̄; SE(β₁) = √(SSR ÷ (n − 2) ÷ Σ(x − x̄)²)",
     "Fits y = β₀ + β₁x by least squares, with the slope's standard error and significance.",
     "regression ols least squares slope intercept linear model econometrics line of best fit", common=True,
     rules=[R("count(x)", "==", "count(y)", "Enter the same number of X and Y values."), R("count(x)", ">=", "3", "Enter at least three pairs.")],
     assumptions="Classical linear model: linear relationship, independent errors with constant variance (homoskedastic), errors roughly normal for t-based inference. Standard errors are not robust.",
     sources=["nist"])

calc("ols_predict", "Regression prediction", ST,
     [F("x", "X (independent)", "series", RX, min=None), F("y", "Y (dependent)", "series", RY, min=None),
      F("x0", "Predict at x =", "x", "12", min=None), CONF()],
     [O("0", "Predicted ŷ", INT + "+" + REG + "*x0", "number", "=FORECAST.LINEAR({x0},{y},{x})"),
      O("1", "Prediction interval ±", "tinv(1-(1-c)/2,count(x)-2)*sqrt(" + SSR + "/(count(x)-2))*sqrt(1+1/count(x)+(x0-avg(x))^2/" + SXX + ")", "number"),
      O("2", "Mean-response interval ±", "tinv(1-(1-c)/2,count(x)-2)*sqrt(" + SSR + "/(count(x)-2))*sqrt(1/count(x)+(x0-avg(x))^2/" + SXX + ")", "number")],
     "ŷ = β₀ + β₁x₀; PI = ŷ ± t* sₑ √(1 + 1/n + (x₀ − x̄)² ÷ Σ(x − x̄)²)",
     "Predicts y at a chosen x, with intervals for a single new observation and for the average response.",
     "forecast prediction interval confidence band regression",
     rules=[R("count(x)", "==", "count(y)", "Enter the same number of X and Y values."), R("count(x)", ">=", "3", "Enter at least three pairs.")],
     assumptions="Same assumptions as OLS. Predictions far outside the observed x range are extrapolation.", sources=["nist"])

calc("f_test", "Regression F-test & adjusted R²", ST,
     [F("r2", "R²", "%", "42", max=0.9999), F("k", "Number of regressors (excluding constant)", "count", "3", min=1),
      F("n", "Observations", "count", "60", min=3)],
     [O("0", "F statistic", "(r2/k)/((1-r2)/(n-k-1))", "number", "=({r2}/{k})/((1-{r2})/({n}-{k}-1))"),
      O("1", "p-value", "1-fcdf((r2/k)/((1-r2)/(n-k-1)),k,n-k-1)", "percent", "=F.DIST.RT(({r2}/{k})/((1-{r2})/({n}-{k}-1)),{k},{n}-{k}-1)"),
      O("2", "Adjusted R²", "1-(1-r2)*(n-1)/(n-k-1)", "percent", "=1-(1-{r2})*({n}-1)/({n}-{k}-1)")],
     "F = (R²/k) ÷ ((1 − R²)/(n − k − 1)); adj. R² = 1 − (1 − R²)(n − 1)/(n − k − 1)",
     "Joint significance of all regressors in a multiple regression, from its R².",
     "f test overall significance anova adjusted r squared multiple regression econometrics",
     rules=[R("n", ">", "k+1", "Need more observations than regressors plus one.")], sources=["nist"])

calc("durbin_watson", "Durbin–Watson statistic", ST,
     [F("e", "Residuals in time order", "series", "0.5; 0.8; 0.3; -0.2; -0.6; -0.4; 0.1; 0.6; 0.4; -0.3; -0.7; -0.2", min=None)],
     [O("0", "Durbin–Watson d", "dw(e)", "number"),
      O("1", "Implied first-order autocorrelation (≈ 1 − d/2)", "1-dw(e)/2", "number")],
     "d = Σ(eₜ − eₜ₋₁)² ÷ Σeₜ²", "Checks regression residuals for first-order serial correlation.",
     "autocorrelation serial correlation time series residuals econometrics",
     rules=[R("count(e)", ">=", "3", "Enter at least three residuals.")],
     interpretation="d near 2 suggests no first-order autocorrelation; well below 2 suggests positive, well above 2 negative. Compare with Durbin–Watson critical values for formal tests.",
     sources=["nist"], excelNotes="With residuals in one row: =SUMXMY2(next cells, previous cells)/SUMSQ(all residuals).")

calc("log_coef", "Interpreting log-model coefficients", ST,
     [F("b", "Estimated coefficient (β)", "x", "0.08", min=None), F("d", "Change in x to interpret", "x", "1", min=None, hint="Units for level x; percent for logged x (e.g. 10 for 10%).")],
     [O("0", "Log-level: % change in y (exact)", "exp(b*d)-1", "percent", "=EXP({b}*{d})-1"),
      O("1", "Log-level: % change in y (approx.)", "b*d", "percent", "={b}*{d}"),
      O("2", "Level-log: change in y for d% change in x", "b*ln(1+d/100)", "number", "={b}*LN(1+{d}/100)"),
      O("3", "Log-log: % change in y for d% change in x", "(1+d/100)^b-1", "percent", "=(1+{d}/100)^{b}-1")],
     "log-level: %Δy = e^(βΔx) − 1; level-log: Δy = β ln(1 + Δ%); log-log: elasticity β",
     "Translates coefficients from log regression models into plain changes in y.",
     "log linear semi elasticity log log interpretation econometrics wage regression",
     interpretation="Read only the row for your model: log-level (ln y on x), level-log (y on ln x), or log-log (ln y on ln x). In log-log, β is an elasticity.")

calc("binomial", "Binomial probability", ST,
     [F("n", "Trials (n)", "count", "20", min=1, max=100000), F("k", "Successes (k)", "count", "6", min=0),
      F("p", "Probability of success", "%", "25", max=1)],
     [O("0", "P(X = k)", "binompmf(n,k,p)", "percent", "=BINOM.DIST({k},{n},{p},FALSE)"),
      O("1", "P(X ≤ k)", "binomcdf(n,k,p)", "percent", "=BINOM.DIST({k},{n},{p},TRUE)"),
      O("2", "P(X ≥ k)", "1-binomcdf(n,k-1,p)", "percent", "=1-BINOM.DIST({k}-1,{n},{p},TRUE)"),
      O("3", "Mean (np)", "n*p", "number", "={n}*{p}"),
      O("4", "Standard deviation", "sqrt(n*p*(1-p))", "number", "=SQRT({n}*{p}*(1-{p}))")],
     "P(X = k) = C(n, k) pᵏ (1 − p)ⁿ⁻ᵏ", "Probabilities for the number of successes in independent yes/no trials.",
     "binomial distribution probability trials successes coin flip",
     rules=[R("k", "<=", "n", "Successes can't exceed trials.")], sources=["openstax_stats"])

# --- Economics ---------------------------------------------------------------------
calc("elasticity", "Elasticity (midpoint method)", EC,
     [F("p1", "Initial price (or income)", "x", "10", min=None), F("q1", "Initial quantity", "x", "1000", min=None),
      F("p2", "New price (or income)", "x", "12", min=None), F("q2", "New quantity", "x", "850", min=None)],
     [O("0", "Elasticity", "((q2-q1)/((q1+q2)/2))/((p2-p1)/((p1+p2)/2))", "number",
        "=(({q2}-{q1})/(({q1}+{q2})/2))/(({p2}-{p1})/(({p1}+{p2})/2))"),
      O("1", "% change in quantity", "(q2-q1)/((q1+q2)/2)", "percent", "=({q2}-{q1})/(({q1}+{q2})/2)"),
      O("2", "% change in price", "(p2-p1)/((p1+p2)/2)", "percent", "=({p2}-{p1})/(({p1}+{p2})/2)"),
      O("3", "Change in total revenue (P × Q)", "p2*q2-p1*q1", "number", "={p2}*{q2}-{p1}*{q1}")],
     "%ΔQ ÷ %ΔP, each change measured against the midpoint",
     "Price, income or cross-price elasticity using the arc (midpoint) formula.",
     "price elasticity of demand supply income elasticity cross price arc midpoint elastic inelastic", common=True,
     rules=[R("p2", "!=", "p1", "Price (or income) must change.")],
     interpretation="For price elasticity of demand, |E| > 1 is elastic (revenue falls when price rises) and |E| < 1 is inelastic. For income elasticity, negative means an inferior good; for cross-price, positive means substitutes.",
     sources=["openstax_econ"])

calc("market_equilibrium", "Supply & demand equilibrium with a tax", EC,
     [F("a", "Demand intercept (P = a − bQ)", "x", "100", min=None), F("b", "Demand slope b", "x", "2", min=0.0000001),
      F("c", "Supply intercept (P = c + dQ)", "x", "10", min=None), F("d", "Supply slope d", "x", "1", min=0.0000001),
      F("t", "Per-unit tax (0 for none)", "x", "6", min=0)],
     [O("0", "Equilibrium quantity (no tax)", "(a-c)/(b+d)", "number", "=({a}-{c})/({b}+{d})"),
      O("1", "Equilibrium price (no tax)", "a-b*(a-c)/(b+d)", "number", "={a}-{b}*({a}-{c})/({b}+{d})"),
      O("2", "Consumer surplus (no tax)", "0.5*b*((a-c)/(b+d))^2", "number", "=0.5*{b}*(({a}-{c})/({b}+{d}))^2"),
      O("3", "Producer surplus (no tax)", "0.5*d*((a-c)/(b+d))^2", "number", "=0.5*{d}*(({a}-{c})/({b}+{d}))^2"),
      O("4", "Quantity with tax", "(a-c-t)/(b+d)", "number", "=({a}-{c}-{t})/({b}+{d})"),
      O("5", "Price buyers pay", "a-b*(a-c-t)/(b+d)", "number", "={a}-{b}*({a}-{c}-{t})/({b}+{d})"),
      O("6", "Price sellers keep", "a-b*(a-c-t)/(b+d)-t", "number", "={a}-{b}*({a}-{c}-{t})/({b}+{d})-{t}"),
      O("7", "Tax revenue", "t*(a-c-t)/(b+d)", "number", "={t}*({a}-{c}-{t})/({b}+{d})"),
      O("8", "Deadweight loss", "0.5*t*((a-c)/(b+d)-(a-c-t)/(b+d))", "number", "=0.5*{t}*(({a}-{c})/({b}+{d})-({a}-{c}-{t})/({b}+{d}))"),
      O("9", "Share of tax paid by buyers", "b/(b+d)", "percent", "={b}/({b}+{d})")],
     "Set a − bQ = c + dQ (+ t); surpluses are triangle areas",
     "Linear market equilibrium, surpluses, and the incidence and deadweight loss of a per-unit tax.",
     "supply demand equilibrium consumer surplus producer surplus deadweight loss tax incidence welfare",
     rules=[R("a", ">", "c+t", "Demand intercept must exceed supply intercept plus the tax, or nothing is traded.")],
     sources=["openstax_econ"])

calc("cpi_inflation", "CPI inflation & real values", EC,
     [F("c0", "CPI in the base period", "x", "258.8", min=0.0001), F("c1", "CPI in the later period", "x", "322.6", min=0.0001),
      F("v", "Dollar amount in the base period", "$", "50000")],
     [O("0", "Inflation between periods", "c1/c0-1", "percent", "={c1}/{c0}-1"),
      O("1", "Same purchasing power in later dollars", "v*c1/c0", "currency", "={v}*{c1}/{c0}"),
      O("2", "Later-period amount in base-period dollars", "v*c0/c1", "currency", "={v}*{c0}/{c1}")],
     "Inflation = CPI₁ ÷ CPI₀ − 1; real value = nominal × CPI_base ÷ CPI_then",
     "Inflation between two CPI readings and converting dollars between years.",
     "cpi inflation price index real nominal purchasing power deflate", sources=["bls_cpi"])

calc("gdp_deflator", "Nominal vs. real GDP", EC,
     [F("ng", "Nominal GDP", "x", "29200", min=0.0001), F("rg", "Real GDP (base-year prices)", "x", "23500", min=0.0001),
      F("ng0", "Prior-year nominal GDP", "x", "27700", min=0.0001), F("rg0", "Prior-year real GDP", "x", "22900", min=0.0001)],
     [O("0", "GDP deflator", "ng/rg*100", "number", "={ng}/{rg}*100"),
      O("1", "Nominal GDP growth", "ng/ng0-1", "percent", "={ng}/{ng0}-1"),
      O("2", "Real GDP growth", "rg/rg0-1", "percent", "={rg}/{rg0}-1"),
      O("3", "Inflation (deflator)", "(ng/rg)/(ng0/rg0)-1", "percent", "=({ng}/{rg})/({ng0}/{rg0})-1")],
     "Deflator = nominal ÷ real × 100", "GDP deflator, nominal and real growth, and implied inflation.",
     "gdp deflator real gdp nominal growth macroeconomics", sources=["openstax_econ"])

calc("rule70", "Growth & the rule of 70", EC,
     [F("g", "Annual growth rate", "%", "2", min=0.0001), F("m", "Multiply by", "x", "4", min=1.0001, hint="E.g. 2 to double, 4 to quadruple.")],
     [O("0", "Rule-of-70 doubling time", "70/(g*100)", "years", "=70/({g}*100)"),
      O("1", "Exact doubling time", "ln(2)/ln(1+g)", "years", "=LN(2)/LN(1+{g})"),
      O("2", "Years to multiply by m", "ln(m)/ln(1+g)", "years", "=LN({m})/LN(1+{g})")],
     "70 ÷ growth %; exact: ln 2 ÷ ln(1 + g)", "How quickly steady growth doubles output, income or prices.",
     "rule of 70 doubling time economic growth gdp per capita", sources=["openstax_econ"])

calc("multiplier", "Spending & tax multipliers", EC,
     [F("mpc", "Marginal propensity to consume", "%", "80", max=0.9999), F("t", "Income tax rate (0 for a simple model)", "%", "0", max=0.99),
      F("dg", "Change in government spending", "x", "100", min=None), F("dt", "Change in lump-sum taxes", "x", "0", min=None)],
     [O("0", "Spending multiplier", "1/(1-mpc*(1-t))", "number", "=1/(1-{mpc}*(1-{t}))"),
      O("1", "Tax multiplier", "-mpc/(1-mpc*(1-t))", "number", "=-{mpc}/(1-{mpc}*(1-{t}))"),
      O("2", "Change in GDP", "dg/(1-mpc*(1-t))-dt*mpc/(1-mpc*(1-t))", "number", "={dg}/(1-{mpc}*(1-{t}))-{dt}*{mpc}/(1-{mpc}*(1-{t}))"),
      O("3", "Marginal propensity to save", "1-mpc", "percent", "=1-{mpc}")],
     "Spending multiplier = 1 ÷ (1 − MPC(1 − t)); tax multiplier = −MPC ÷ (1 − MPC(1 − t))",
     "Keynesian multipliers and the change in GDP from fiscal policy.",
     "keynesian multiplier mpc mps fiscal policy government spending aggregate demand",
     assumptions="Simple closed-economy Keynesian cross: fixed prices and interest rates, no crowding out, no imports.", sources=["openstax_econ"])

calc("money", "Money multiplier & quantity theory", EC,
     [F("rr", "Reserve requirement", "%", "10", min=0.0001, max=1), F("dep", "New reserves / deposit", "x", "1000", min=None),
      F("gm", "Money growth", "%", "6", min=-0.99), F("gv", "Velocity growth", "%", "0", min=-0.99), F("gy", "Real output growth", "%", "2", min=-0.99)],
     [O("0", "Simple money multiplier", "1/rr", "number", "=1/{rr}"),
      O("1", "Maximum new money created", "dep/rr", "number", "={dep}/{rr}"),
      O("2", "Implied inflation (MV = PY)", "(1+gm)*(1+gv)/(1+gy)-1", "percent", "=(1+{gm})*(1+{gv})/(1+{gy})-1"),
      O("3", "Approximation (%ΔM + %ΔV − %ΔY)", "gm+gv-gy", "percent", "={gm}+{gv}-{gy}")],
     "Multiplier = 1 ÷ reserve ratio; %ΔP ≈ %ΔM + %ΔV − %ΔY",
     "Deposit expansion and the inflation implied by the quantity theory of money.",
     "money multiplier reserve ratio quantity theory mv=py velocity monetary", sources=["openstax_econ"],
     assumptions="Textbook multiplier: banks lend all excess reserves and the public holds no extra cash. (The U.S. reserve requirement has been 0% since 2020; the textbook model remains a teaching tool.)")

calc("taylor_rule", "Taylor rule", EC,
     [F("rn", "Neutral real interest rate", "%", "1", min=-0.1), F("pi", "Inflation", "%", "3", min=-0.2),
      F("pit", "Inflation target", "%", "2", min=-0.1), F("gap", "Output gap (+ above potential)", "%", "-0.5", min=-0.5, max=0.5),
      F("wp", "Weight on inflation gap", "x", "0.5", min=0), F("wy", "Weight on output gap", "x", "0.5", min=0)],
     [O("0", "Suggested policy rate", "rn+pi+wp*(pi-pit)+wy*gap", "percent", "={rn}+{pi}+{wp}*({pi}-{pit})+{wy}*{gap}"),
      O("1", "Implied real policy rate", "rn+wp*(pi-pit)+wy*gap", "percent", "={rn}+{wp}*({pi}-{pit})+{wy}*{gap}")],
     "i = r* + π + 0.5(π − π*) + 0.5(output gap)", "Policy interest rate suggested by the Taylor (1993) rule.",
     "taylor rule federal funds rate monetary policy central bank", sources=["openstax_econ"],
     interpretation="A benchmark, not a forecast of what the Fed will do. Results swing with the neutral-rate and output-gap estimates.")

calc("labor_market", "Unemployment & labor force rates", EC,
     [F("u", "Unemployed", "x", "7.1", min=0, hint="Same units throughout (e.g. millions)."), F("e", "Employed", "x", "163.2", min=0),
      F("pop", "Working-age population (16+, civilian non-institutional)", "x", "272.0", min=0.0001)],
     [O("0", "Unemployment rate", "u/(u+e)", "percent", "={u}/({u}+{e})"),
      O("1", "Labor force participation rate", "(u+e)/pop", "percent", "=({u}+{e})/{pop}"),
      O("2", "Employment-population ratio", "e/pop", "percent", "={e}/{pop}"),
      O("3", "Labor force", "u+e", "number", "={u}+{e}")],
     "Unemployment = U ÷ (U + E); participation = (U + E) ÷ population", "Core labor-market rates as defined by the BLS.",
     "unemployment rate labor force participation employment population", sources=["bls_cps"],
     rules=[R("u+e", "<=", "pop", "The labor force can't exceed the working-age population.")])

calc("okun", "Okun's law", EC,
     [F("u", "Unemployment rate", "%", "5.5", max=1), F("un", "Natural rate of unemployment", "%", "4.2", max=1),
      F("k", "Okun coefficient", "x", "2", min=0), F("yp", "Potential GDP", "x", "29000", min=0)],
     [O("0", "Output gap", "-k*(u-un)", "percent", "=-{k}*({u}-{un})"),
      O("1", "Lost output", "-k*(u-un)*yp", "number", "=-{k}*({u}-{un})*{yp}")],
     "Output gap ≈ −k × (u − u*)", "Rule-of-thumb link between unemployment above its natural rate and lost output.",
     "okun's law output gap cyclical unemployment recession", sources=["openstax_econ"])

calc("monopoly", "Monopoly vs. competition (linear demand)", EC,
     [F("a", "Demand intercept (P = a − bQ)", "x", "120", min=None), F("b", "Demand slope b", "x", "2", min=0.0000001),
      F("mc", "Constant marginal cost", "x", "20", min=0), F("fc", "Fixed cost", "x", "300", min=0)],
     [O("0", "Monopoly quantity (MR = MC)", "(a-mc)/(2*b)", "number", "=({a}-{mc})/(2*{b})"),
      O("1", "Monopoly price", "(a+mc)/2", "number", "=({a}+{mc})/2"),
      O("2", "Monopoly profit", "(a-mc)^2/(4*b)-fc", "number", "=({a}-{mc})^2/(4*{b})-{fc}"),
      O("3", "Competitive quantity (P = MC)", "(a-mc)/b", "number", "=({a}-{mc})/{b}"),
      O("4", "Deadweight loss of monopoly", "(a-mc)^2/(8*b)", "number", "=({a}-{mc})^2/(8*{b})"),
      O("5", "Lerner index (P − MC) ÷ P", "((a+mc)/2-mc)/((a+mc)/2)", "percent", "=(({a}+{mc})/2-{mc})/(({a}+{mc})/2)")],
     "MR = a − 2bQ = MC; DWL = (a − MC)² ÷ 8b",
     "Profit-maximizing monopoly outcome compared with perfect competition.",
     "monopoly marginal revenue market power deadweight loss lerner index microeconomics",
     rules=[R("a", ">", "mc", "Demand intercept must exceed marginal cost.")], sources=["openstax_econ"])

calc("costs", "Cost curves", EC,
     [F("fc", "Fixed cost", "x", "500", min=0), F("q1", "Quantity 1", "x", "100", min=0.0000001), F("vc1", "Variable cost at Q1", "x", "1200", min=0),
      F("q2", "Quantity 2", "x", "110", min=0.0000001), F("vc2", "Variable cost at Q2", "x", "1350", min=0)],
     [O("0", "Marginal cost (Q1 → Q2)", "(vc2-vc1)/(q2-q1)", "number", "=({vc2}-{vc1})/({q2}-{q1})"),
      O("1", "Average total cost at Q2", "(fc+vc2)/q2", "number", "=({fc}+{vc2})/{q2}"),
      O("2", "Average variable cost at Q2", "vc2/q2", "number", "={vc2}/{q2}"),
      O("3", "Average fixed cost at Q2", "fc/q2", "number", "={fc}/{q2}")],
     "MC = ΔTC ÷ ΔQ; ATC = TC ÷ Q; AVC = VC ÷ Q; AFC = FC ÷ Q",
     "Marginal and average costs from two output levels.", "marginal cost average total cost variable fixed cost microeconomics",
     rules=[R("q2", "!=", "q1", "The two quantities must differ.")], sources=["openstax_econ"])

calc("hhi", "Market concentration (HHI)", EC,
     [F("s", "Market shares (%)", "series", "30; 25; 20; 15; 10", min=None, hint="Each firm's share in percent, e.g. 30; 25; 20.")],
     [O("0", "Herfindahl–Hirschman Index", "sum(s^2)", "number", "=SUMSQ({s})"),
      O("1", "Four-firm concentration ratio (CR4)", "topsum(s,4)/100", "percent", "=SUM(LARGE({s},{1,2,3,4}))/100"),
      O("2", "Total of shares entered", "sum(s)/100", "percent", "=SUM({s})/100")],
     "HHI = Σ (share in %)²", "Concentration index used in antitrust review.",
     "hhi herfindahl concentration ratio antitrust merger market structure oligopoly",
     interpretation="Under the 2023 U.S. Merger Guidelines, an HHI above 1,800 indicates a highly concentrated market.",
     sources=["openstax_econ"])

calc("cobb_douglas", "Cobb–Douglas production & growth accounting", EC,
     [F("A", "Total factor productivity (A)", "x", "1.5", min=0.0000001), F("K", "Capital (K)", "x", "400", min=0.0000001),
      F("L", "Labor (L)", "x", "100", min=0.0000001), F("al", "Capital share (α)", "%", "33", min=0.0001, max=0.9999),
      F("gy", "Output growth", "%", "3", min=-0.5), F("gk", "Capital growth", "%", "4", min=-0.5), F("gl", "Labor growth", "%", "1", min=-0.5)],
     [O("0", "Output Y = A Kᵅ L¹⁻ᵅ", "A*K^al*L^(1-al)", "number", "={A}*{K}^{al}*{L}^(1-{al})"),
      O("1", "Marginal product of capital", "al*A*K^al*L^(1-al)/K", "number", "={al}*{A}*{K}^{al}*{L}^(1-{al})/{K}"),
      O("2", "Marginal product of labor", "(1-al)*A*K^al*L^(1-al)/L", "number", "=(1-{al})*{A}*{K}^{al}*{L}^(1-{al})/{L}"),
      O("3", "Output per worker", "A*K^al*L^(1-al)/L", "number", "={A}*{K}^{al}*{L}^(1-{al})/{L}"),
      O("4", "TFP growth (Solow residual)", "gy-al*gk-(1-al)*gl", "percent", "={gy}-{al}*{gk}-(1-{al})*{gl}")],
     "Y = A Kᵅ L¹⁻ᵅ; g_A = g_Y − α g_K − (1 − α) g_L",
     "Output and marginal products under Cobb–Douglas, plus the Solow growth-accounting residual.",
     "cobb douglas production function solow growth accounting tfp marginal product macroeconomics", sources=["openstax_econ"])

calc("comparative_advantage", "Comparative advantage", EC,
     [F("ax", "Country A: max output of good X", "x", "120", min=0.0000001), F("ay", "Country A: max output of good Y", "x", "60", min=0.0000001),
      F("bx", "Country B: max output of good X", "x", "40", min=0.0000001), F("by", "Country B: max output of good Y", "x", "80", min=0.0000001)],
     [O("0", "A's opportunity cost of 1 X (in Y)", "ay/ax", "number", "={ay}/{ax}"),
      O("1", "B's opportunity cost of 1 X (in Y)", "by/bx", "number", "={by}/{bx}"),
      O("2", "A's opportunity cost of 1 Y (in X)", "ax/ay", "number", "={ax}/{ay}"),
      O("3", "B's opportunity cost of 1 Y (in X)", "bx/by", "number", "={bx}/{by}")],
     "Opportunity cost of X = Y given up ÷ X gained",
     "Opportunity costs from production possibilities, to see who has the comparative advantage.",
     "comparative advantage absolute advantage opportunity cost trade ppf production possibilities",
     interpretation="The country with the lower opportunity cost of a good has the comparative advantage in it. Mutually beneficial trade happens at a price between the two opportunity costs.",
     sources=["openstax_econ"])

# --- Planning & protection ---------------------------------------------------------
calc("net_worth", "Net worth", PL,
     [F("cash", "Cash and savings", "$", "80000"), F("inv", "Taxable investments", "$", "650000"),
      F("ret", "Retirement accounts", "$", "900000"), F("re", "Real estate", "$", "1200000"),
      F("oth", "Other assets", "$", "60000"), F("mort", "Mortgages", "$", "600000"), F("debt", "Other debt", "$", "40000")],
     [O("0", "Net worth", "cash+inv+ret+re+oth-mort-debt", "currency", "={cash}+{inv}+{ret}+{re}+{oth}-{mort}-{debt}"),
      O("1", "Total assets", "cash+inv+ret+re+oth", "currency", "={cash}+{inv}+{ret}+{re}+{oth}"),
      O("2", "Debt-to-assets", "if(cash+inv+ret+re+oth>0,(mort+debt)/(cash+inv+ret+re+oth),0)", "percent",
        "=({mort}+{debt})/({cash}+{inv}+{ret}+{re}+{oth})"),
      O("3", "Liquid share of assets (cash + taxable)", "if(cash+inv+ret+re+oth>0,(cash+inv)/(cash+inv+ret+re+oth),0)", "percent",
        "=({cash}+{inv})/({cash}+{inv}+{ret}+{re}+{oth})")],
     "Assets − liabilities", "Household balance sheet summary.", "balance sheet assets liabilities", common=True)

calc("savings_rate", "Savings rate", PL,
     [F("s", "Annual savings (including employer match)", "$", "45000"), F("i", "Gross income", "$", "250000", min=0.01)],
     [O("0", "Savings rate", "s/i", "percent", "={s}/{i}")],
     "Savings ÷ gross income", "Share of income being saved.", "save percent of income")

calc("emergency_fund", "Emergency fund", PL,
     [F("e", "Monthly essential expenses", "$", "9000"), F("m", "Months of coverage", "x", "6", hint="Months, e.g. 6."),
      F("h", "Cash on hand", "$", "30000")],
     [O("0", "Target", "e*m", "currency", "={e}*{m}"),
      O("1", "Gap (+) / excess (−)", "e*m-h", "currency", "={e}*{m}-{h}"),
      O("2", "Months currently covered", "if(e>0,h/e,0)", "number", "={h}/{e}")],
     "Monthly expenses × months", "Cash reserve target and how far current cash goes.", "rainy day reserve liquidity")

calc("college", "College savings (529)", PL,
     [F("c", "Annual cost today", "$", "40000"), F("i", "College cost inflation", "%", "5", min=0.0001),
      F("n", "Years until college starts", "years", "10", min=1), F("y", "Years of college", "years", "4", min=1),
      F("p", "Saved so far", "$", "30000"), F("r", "Annual return", "%", "6", min=0.0001)],
     [O("0", "Total projected cost", "c*(1+i)^n*((1+i)^y-1)/i", "currency", "={c}*(1+{i})^{n}*((1+{i})^{y}-1)/{i}"),
      O("1", "Current savings at college start", "p*(1+r/12)^(n*12)", "currency", "=FV({r}/12,{n}*12,0,-{p})"),
      O("2", "Monthly saving needed", "max(0,(c*(1+i)^n*((1+i)^y-1)/i-p*(1+r/12)^(n*12))*(r/12)/((1+r/12)^(n*12)-1))", "currency",
        "=MAX(0,-PMT({r}/12,{n}*12,-{p},{c}*(1+{i})^{n}*((1+{i})^{y}-1)/{i}))")],
     "Cost grows with inflation each year; full cost funded by the first day of college",
     "Projected cost of college and the monthly saving to cover it.",
     "529 education tuition saving",
     assumptions="Conservative simplification: the whole multi-year cost is funded by the start of college, and the balance earns nothing extra during school. Ignores financial aid and tax benefits.")

calc("life_insurance", "Life insurance need", PL,
     [F("inc", "Income to replace each year", "$", "200000"), F("n", "Years to replace it", "years", "20", min=1),
      F("r", "Return on the payout", "%", "4", min=0), F("debt", "Debts to pay off", "$", "500000"),
      F("edu", "Education and other goals", "$", "300000"), F("cov", "Existing coverage", "$", "1000000"),
      F("assets", "Assets available", "$", "400000")],
     [O("0", "Coverage needed", "max(0,pv(r,n,inc)+debt+edu-cov-assets)", "currency",
        "=MAX(0,PV({r},{n},-{inc})+{debt}+{edu}-{cov}-{assets})"),
      O("1", "Income replacement (present value)", "pv(r,n,inc)", "currency", "=PV({r},{n},-{inc})")],
     "PV(income) + debts + goals − existing coverage − assets",
     "Needs-based estimate of additional life insurance.", "insurance needs analysis term life",
     assumptions="Income replacement is a level end-of-year amount; ignores taxes, inflation, Social Security survivor benefits and final expenses unless included in goals.")

calc("estate_exposure", "Estate tax exposure", PL,
     [F("e", "Estate value", "$", "22000000"), F("g", "Lifetime taxable gifts already made", "$", "2000000"),
      F("m", "Married with portability?", "choice", "1", options=[{"value": 1, "label": "No (one exemption)"}, {"value": 2, "label": "Yes (two exemptions)"}])],
     [O("0", "Exemption available", "max(0,estateexemption()*m-g)", "currency"),
      O("1", "Amount over the exemption", "max(0,e-max(0,estateexemption()*m-g))", "currency"),
      O("2", "Approximate federal estate tax", "estaterate()*max(0,e-max(0,estateexemption()*m-g))", "currency"),
      O("3", "Annual gift exclusion per recipient", "giftexclusion()", "currency")],
     "Top rate × (estate − remaining exemption)", "Rough federal estate tax exposure using the current exemption.",
     "estate tax exemption gift portability", interpretation=TAX_INTERP + " Uses the top 40% rate as an approximation; state estate taxes are excluded.",
     sources=["estate", "gift"])

calc("debt_vs_invest", "Pay down debt or invest", PL,
     [F("d", "Debt interest rate", "%", "6.5"), F("dt", "Tax benefit on interest (rate deducted)", "%", "0", max=1),
      F("r", "Expected investment return", "%", "7", min=-0.99), F("t", "Tax rate on the return", "%", "15", max=1)],
     [O("0", "After-tax cost of the debt", "d*(1-dt)", "percent", "={d}*(1-{dt})"),
      O("1", "After-tax investment return", "r*(1-t)", "percent", "={r}*(1-{t})"),
      O("2", "Investing minus paying down", "r*(1-t)-d*(1-dt)", "percent", "={r}*(1-{t})-{d}*(1-{dt})")],
     "After-tax return − after-tax debt cost",
     "Compares the guaranteed return of paying down debt with an expected (uncertain) investment return.",
     "prepay mortgage extra payments invest",
     interpretation="Paying down debt earns its rate with certainty; the investment return is an expectation with risk. A positive number is not a recommendation to invest.")

calc("loan_payment", "Loan payment", PL,
     [F("p", "Loan amount", "$", "800000"), F("r", "Interest rate", "%", "6.25"), F("y", "Term in years", "years", "30", min=1)],
     [O("0", "Monthly payment", "pmt(r/12,y*12,p)", "currency", "=PMT({r}/12,{y}*12,-{p})"),
      O("1", "Total interest", "pmt(r/12,y*12,p)*y*12-p", "currency", "=PMT({r}/12,{y}*12,-{p})*{y}*12-{p}")],
     "Principal × i ÷ (1 − (1+i)^−n), monthly", "Fully amortizing monthly payment and lifetime interest.",
     "mortgage amortization monthly payment")


# ---------------------------------------------------------------------------
# Evaluate examples and write the catalog
# ---------------------------------------------------------------------------

def parse_example(f):
    s = f["example"]
    if f["unit"] == "series":
        return Series(float(x) for x in re.split(r"[;\n]", s) if x.strip())
    v = float(s)
    return v / 100 if f["unit"] == "%" else v



def main():
    ids = set()
    for c in CATALOG:
        assert c["id"] not in ids, c["id"]
        ids.add(c["id"])
        scope = {f["id"]: parse_example(f) for f in c["fields"]}
        if c["projection"]:
            scalars, rows = PROJECTIONS[c["projection"]](scope)
            scope.update(scalars)
            c["table"] = PROJECTION_TABLES[c["projection"]]
        for rule in c["rules"]:
            ok = {"<": lambda a, b: a < b, "<=": lambda a, b: a <= b, ">": lambda a, b: a > b,
                  ">=": lambda a, b: a >= b, "==": lambda a, b: a == b, "!=": lambda a, b: a != b}[rule["relation"]](
                ref_eval(rule["left"], scope), ref_eval(rule["right"], scope))
            assert ok, (c["id"], rule)
        for o in c["outputs"]:
            v = ref_eval(o["expression"], scope)
            o["expected"] = None if (isinstance(v, float) and math.isnan(v)) else float(v)
        if c["projection"] is None:
            del c["projection"]
    out = os.path.join(ROOT, "Resources", "catalog.json")
    with open(out, "w") as fh:
        json.dump(CATALOG, fh, indent=1, ensure_ascii=False)
    cats = {}
    for c in CATALOG:
        cats[c["category"]] = cats.get(c["category"], 0) + 1
    print(f"Wrote {len(CATALOG)} calculators to {out}")
    for k, v in cats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
