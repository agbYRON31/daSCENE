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
TAX = json.load(open(os.path.join(ROOT, "Resources", "taxdata.json")))

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
    g = (1 + r) ** n
    return pv * g + pmt * (g - 1) / r


def pv(r, n, pmt):
    if r == 0:
        return pmt * n
    return pmt * (1 - (1 + r) ** (-n)) / r


def pmt(r, n, pv_):
    if r == 0:
        return pv_ / n
    return pv_ * r / (1 - (1 + r) ** (-n))


def nper(r, pmt_, pv_, fv_):
    if r == 0:
        return (fv_ - pv_) / pmt_
    return math.log((fv_ * r + pmt_) / (pv_ * r + pmt_)) / math.log(1 + r)


def npv(r, cf):
    return sum(c / (1 + r) ** t for t, c in enumerate(cf))


def irr(cf):
    lo, hi = -0.9999, 10.0
    flo = npv(lo, cf)
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
    for _ in range(400):
        mid = (lo + hi) / 2
        if (pv(mid, n, pmt_) if mid != 0 else pmt_ * n) > pv_:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


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
    "iff": iff,
}


def ref_eval(expr, scope):
    py = expr.replace("^", "**")
    py = re.sub(r"\bif\(", "iff(", py)
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


PROJECTIONS = {"retirement": proj_retirement, "montecarlo": proj_montecarlo}
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
TAX_INTERP = ("Uses the federal figures in the app's tax table for tax year {y}. Excludes state tax, AMT, credits, "
              "phase-outs and payroll taxes. Confirm against current IRS guidance.").format(y=TAX["taxYear"])

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
    "gift": {"title": "IRS • Gift tax FAQs", "url": "https://www.irs.gov/businesses/small-businesses-self-employed/frequently-asked-questions-on-gift-taxes"},
}

CATALOG = []


def F(id, label, unit, example, hint=None, min=0, max=None, integer=False, options=None):
    f = {"id": id, "label": label, "unit": unit, "example": example, "hint": hint or HINTS[unit]}
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


G = "Growth & time value"
RET = "Retirement & income"
TX = "Tax"
PF = "Portfolio & risk"
FEE = "Fees & costs"
PL = "Planning & protection"

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

calc("monte_carlo", "Monte Carlo withdrawal test", RET,
     [F("bal", "Starting portfolio", "$", "2000000"), F("w", "First-year withdrawal", "$", "80000"),
      F("years", "Years", "years", "30", min=1, max=100, integer=True), F("mean", "Average annual return", "%", "6", min=-0.5),
      F("sd", "Volatility (standard deviation)", "%", "12", max=1), F("infl", "Withdrawal increase each year", "%", "2.5", min=-0.5),
      F("sims", "Number of simulations", "count", "2000", min=100, max=20000),
      F("seed", "Random seed", "count", "42", hint="Same seed gives the same result; change it to see a different draw.")],
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
                  ">=": lambda a, b: a >= b, "==": lambda a, b: a == b}[rule["relation"]](
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
