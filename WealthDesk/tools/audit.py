#!/usr/bin/env python3
"""Independent accuracy audit of every Wealth Desk calculator.

`wdcheck` proves the Swift engine reproduces the Python reference engine. That catches engine
bugs but not a wrong formula, because both evaluate the same expression. This audit closes the
gap: for every calculator it recomputes each output by a *different method* that does not use
the catalog's formulas or the reference engine's financial functions:

  * year-by-year / month-by-month simulation instead of closed-form time-value formulas
  * discounted cash-flow sums and numerical derivatives for bonds
  * bisection on the defining equation for every "solve for" calculator
  * the IRS's printed "base amount plus rate × excess" tables for income tax
  * numerical integration of the normal / t / F densities, exact combinatorics for the binomial
  * Python's `statistics` library for descriptive statistics and regression
  * deterministic limits and sampling theory for the Monte Carlo simulations

Each calculator is checked at its example inputs and at extra edge cases (zero and negative
rates, long horizons, bracket boundaries, depletion, extreme allocations).

Run:  python3 -I tools/audit.py            (writes docs/ACCURACY_AUDIT.md, exits 1 on any failure)
"""
import importlib.util
import json
import math
import os
import statistics as st
import sys
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location("build_catalog", os.path.join(HERE, "build_catalog.py"))
bc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bc)
CATALOG = {c["id"]: c for c in json.load(open(os.path.join(ROOT, "Resources", "catalog.json")))}


class V(dict):
    __getattr__ = dict.__getitem__


def example_inputs(calc):
    v = V()
    for f in calc["fields"]:
        if f["unit"] == "series":
            v[f["id"]] = [float(x) for x in f["example"].replace("\n", ";").split(";") if x.strip()]
        else:
            x = float(f["example"])
            v[f["id"]] = x / 100 if f["unit"] == "%" else x
    return v


def app_eval(calc, v):
    """The app's answer: catalog expressions evaluated by the reference engine (proven equal to Swift by wdcheck)."""
    scope = {k: (bc.Series(x) if isinstance(x, list) else x) for k, x in v.items()}
    if calc.get("projection"):
        scalars, _rows = bc.PROJECTIONS[calc["projection"]](scope)
        scope.update(scalars)
    out = []
    for o in calc["outputs"]:
        try:
            out.append(float(bc.ref_eval(o["expression"], scope)))
        except (ZeroDivisionError, ValueError, OverflowError):
            out.append(float("nan"))
    return out


# ── Independent numerical tools ────────────────────────────────────────────────
def bisect(f, lo, hi, it=300):
    flo = f(lo)
    for _ in range(it):
        mid = (lo + hi) / 2
        fm = f(mid)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2


def nmax(r):
    """Largest exponent n for which (1+r)^n stays finite in floating point."""
    return 700 / math.log(1 + r)


def simpson(f, a, b, n=4000):
    if a == b:
        return 0.0
    h = (b - a) / n
    s = f(a) + f(b)
    for i in range(1, n):
        s += (4 if i % 2 else 2) * f(a + i * h)
    return s * h / 3


def grow(x, r, periods):
    """Compound period by period (whole periods), then a fractional remainder by exp/log."""
    whole = int(math.floor(periods))
    for _ in range(whole):
        x *= 1 + r
    frac = periods - whole
    return x * math.exp(frac * math.log(1 + r)) if frac else x


def accumulate(p, c, r, n):
    """Balance after n whole periods of growth with an end-of-period contribution."""
    bal = p
    for _ in range(int(round(n))):
        bal = bal * (1 + r) + c
    return bal


def annuity_pv(pmt, r, n):
    return sum(pmt / (1 + r) ** k for k in range(1, int(round(n)) + 1))


def phi(z):
    return 0.5 + simpson(lambda x: math.exp(-x * x / 2) / math.sqrt(2 * math.pi), 0, z)


def t_pdf(x, df):
    return math.exp(math.lgamma((df + 1) / 2) - math.lgamma(df / 2)) / math.sqrt(df * math.pi) * (1 + x * x / df) ** (-(df + 1) / 2)


def t_cdf(t, df):
    return 0.5 + simpson(lambda x: t_pdf(x, df), 0, t, 20000)


def f_tail(f, d1, d2):
    """P(F > f) by integrating the F density over its upper tail."""
    lg = math.lgamma((d1 + d2) / 2) - math.lgamma(d1 / 2) - math.lgamma(d2 / 2)
    pdf = lambda x: math.exp(lg + (d1 / 2) * math.log(d1 / d2) + (d1 / 2 - 1) * math.log(x) - ((d1 + d2) / 2) * math.log(1 + d1 * x / d2))
    return simpson(pdf, f, f + 400, 200000)


def bond_cashflow_price(face, cpn, y, years, freq):
    n = int(math.floor(years * freq + 0.5))
    c = face * cpn / freq
    return sum((c + (face if k == n else 0)) / (1 + y / freq) ** k for k in range(1, n + 1))


# IRS Rev. Proc. 2025-32 (tax year 2026), section 4.01: (over, base tax, rate on the excess)
IRS_2026 = {
    1: [(0, 0, .10), (12400, 1240, .12), (50400, 5800, .22), (105700, 17966, .24), (201775, 41024, .32), (256225, 58448, .35), (640600, 192979.25, .37)],
    2: [(0, 0, .10), (24800, 2480, .12), (100800, 11600, .22), (211400, 35932, .24), (403550, 82048, .32), (512450, 116896, .35), (768700, 206583.50, .37)],
    3: [(0, 0, .10), (17700, 1770, .12), (67450, 7740, .22), (105700, 16155, .24), (201750, 39207, .32), (256200, 56631, .35), (640600, 191171, .37)],
}
STD_2026 = {1: 16100, 2: 32200, 3: 24150}
LTCG_2026 = {1: (49450, 545500), 2: (98900, 613700), 3: (66200, 579600)}
NIIT_THR = {1: 200000, 2: 250000, 3: 200000}
UNIFORM = {72: 27.4, 73: 26.5, 75: 24.6, 80: 20.2, 85: 16.0, 90: 12.2, 95: 8.9, 100: 6.4, 110: 3.5, 120: 2.0}  # Pub. 590-B App. B


def irs_tax(ti, status):
    ti = max(0.0, ti)
    row = [r for r in IRS_2026[int(status)] if ti >= r[0]][-1]
    return row[1] + row[2] * (ti - row[0])


def irs_marginal(ti, status):
    return [r for r in IRS_2026[int(status)] if ti >= r[0]][-1][2]


def irs_room(ti, status):
    nxt = [r[0] for r in IRS_2026[int(status)] if r[0] > ti]
    return nxt[0] - max(ti, 0) if nxt else float("nan")


def ltcg_cumulative(x, status):
    t0, t15 = LTCG_2026[int(status)]
    return 0.15 * max(0, min(x, t15) - t0) + 0.20 * max(0, x - t15)


# ── Independent implementations, one per calculator ─────────────────────────────
IND = {}


def ind(cid, how, tol=1e-9, cases=()):
    def deco(fn):
        IND[cid] = dict(fn=fn, how=how, tol=tol, cases=list(cases))
        return fn
    return deco


DEF = "Recomputed directly from the definition"
SIM = "Period-by-period simulation"
SOLVE = "Bisection on the defining equation"

# Everyday math
ind("percentages", DEF)(lambda v: [v.pct * v.of, v.part / v.whole, (v.new - v.old) / abs(v.old), v.of + v.of * v.pct, v.of - v.of * v.pct])
@ind("tip_split", DEF)
def _(v):
    tip = (v.bill - v.tax) * v.tip
    return [tip, v.bill + tip, (v.bill + tip) / v.people]
@ind("discount", "Sequential discounts applied step by step")
def _(v):
    sale = v.price - v.price * v.d1
    sale -= sale * v.d2
    return [sale, v.price - sale, (v.price - sale) / v.price, sale + sale * v.tax]
ind("unit_price", DEF)(lambda v: [v.pa / v.qa, v.pb / v.qb, (v.pb / v.qb - v.pa / v.qa) / (v.pa / v.qa)])
ind("weighted_avg", "Explicit sums and statistics.mean")(lambda v: [sum(x * w for x, w in zip(v.x, v.w)) / sum(v.w), st.mean(v.x), sum(v.w)])
ind("grade_needed", SOLVE)(lambda v: [bisect(lambda s: v.cur * (1 - v.wf) + s * v.wf - v.target, -1e5, 1e5)])

# Growth & time value
ind("fv_lump", SIM, cases=[dict(r=0.0), dict(r=-0.2), dict(n=100), dict(n=7.5)])(lambda v: [grow(v.p, v.r, v.n), grow(v.p, v.r, v.n) - v.p])
@ind("fv_contrib", SIM, cases=[dict(r=0.0), dict(r=-0.05), dict(n=60), dict(p=0.0)])
def _(v):
    b = accumulate(v.p, v.c, v.r, v.n)
    return [b, v.p + v.c * v.n, b - v.p - v.c * v.n]
ind("fv_monthly", "Month-by-month simulation", cases=[dict(r=0.0), dict(r=-0.06), dict(y=50)])(
    lambda v: [accumulate(v.p, v.m, v.r / 12, v.y * 12), v.p + v.m * 12 * v.y])
ind("pv_goal", SOLVE, cases=[dict(r=0.0), dict(n=60)])(lambda v: [bisect(lambda x: grow(x, v.r, v.n) - v.g, 0, v.g * 1e3 + 1)])
@ind("savings_needed", "Bisection on a year-by-year simulation", cases=[dict(p=0.0), dict(n=45), dict(p=900000.0)])
def _(v):
    c = max(0.0, bisect(lambda c: accumulate(v.p, c, v.r, v.n) - v.g, -1e9, 1e9))
    return [c, c / 12]
ind("years_to_goal", SOLVE, cases=[dict(c=0.0), dict(r=0.02)])(
    lambda v: [bisect(lambda n: v.p * (1 + v.r) ** n + v.c * ((1 + v.r) ** n - 1) / v.r - v.g, 0, 2000)])
ind("cagr", SOLVE, cases=[dict(e=60000.0), dict(n=0.5)])(lambda v: [bisect(lambda x: v.s * (1 + x) ** v.n - v.e, -0.999999, 1e4)])
ind("real_return", DEF, cases=[dict(r=-0.1), dict(i=-0.02)])(lambda v: [(1 + v.r) / (1 + v.i) - 1, v.r - v.i])
ind("rule72", SOLVE)(lambda v: [72 / (v.r * 100), bisect(lambda n: (1 + v.r) ** n - 2, 0, nmax(v.r))])
ind("inflation_cost", SIM, cases=[dict(i=0.0), dict(i=-0.01), dict(n=60)])(lambda v: [grow(v.c, v.i, v.n), v.c / grow(1.0, v.i, v.n)])
@ind("effective_rate", "Compounded period by period", cases=[dict(m=1.0), dict(m=365.0), dict(r=0.0)])
def _(v):
    x = 1.0
    for _ in range(int(v.m)):
        x *= 1 + v.r / v.m
    return [x - 1]

# Retirement & income
ind("nest_egg", DEF, cases=[dict(o=200000.0)])(lambda v: [max(0, v.s - v.o) / v.w, max(0, v.s - v.o)])
@ind("retire_gap", SIM, cases=[dict(r=0.0), dict(n=40)])
def _(v):
    need, proj = max(0, v.s - v.o) / v.w, accumulate(v.b, v.c, v.r, v.n)
    return [need, proj, proj - need]
ind("withdrawal_rate", DEF)(lambda v: [v.w / v.b])
@ind("level_withdrawal", "Bisection on a year-by-year drawdown to exactly zero", cases=[dict(r=0.0), dict(r=-0.02), dict(n=60)])
def _(v):
    def left(w):
        bal = v.b
        for _ in range(int(v.n)):
            bal = bal * (1 + v.r) - w
        return bal
    return [bisect(left, 0, v.b * 5)]
ind("longevity", SOLVE, cases=[dict(w=200000.0), dict(r=0.01)])(
    lambda v: [bisect(lambda n: v.b * (1 + v.r) ** n - v.w * ((1 + v.r) ** n - 1) / v.r, 1e-9, min(5000, nmax(v.r)))])
ind("growing_annuity", "Sum of each year's discounted payment", cases=[dict(g=0.05), dict(g=0.0), dict(r=0.0, g=0.02), dict(n=60)])(
    lambda v: [sum(v.s * (1 + v.g) ** (k - 1) / (1 + v.r) ** k for k in range(1, int(v.n) + 1))])
ind("ss_breakeven", SOLVE)(lambda v: [bisect(lambda x: v.a1 * 12 * (x - v.e) - v.a2 * 12 * (x - v.l), v.l, 500), v.a1 * 12 * (v.l - v.e)])
@ind("pension_value", "Sum of discounted monthly payments; bisection for the implied return", tol=1e-8, cases=[dict(r=0.0), dict(n=40)])
def _(v):
    pv = annuity_pv(v.b, v.r / 12, v.n * 12)
    i = bisect(lambda i: annuity_pv(v.b, i, v.n * 12) - v.l, -0.009, 0.5)
    return [pv, v.l - pv, i * 12]
ind("rmd", "IRS Pub. 590-B Uniform Lifetime Table values", cases=[dict(a=x) for x in UNIFORM])(
    lambda v: [v.b / UNIFORM[int(v.a)], UNIFORM[int(v.a)], 1 / UNIFORM[int(v.a)]])
@ind("contrib_limits", "IRS Notice 2025-67 limits (2026)", cases=[dict(a=35), dict(a=50), dict(a=59), dict(a=60), dict(a=63), dict(a=64), dict(k=40000.0, i=9000.0)])
def _(v):
    k = 24500 + (11250 if 60 <= v.a <= 63 else 8000 if v.a >= 50 else 0)
    i = 7500 + (1100 if v.a >= 50 else 0)
    return [k, max(0, k - v.k), i, max(0, i - v.i)]
ind("employer_match", DEF, cases=[dict(c=0.10), dict(c=0.0)])(lambda v: [v.s * min(v.c, v.cap) * v.m, v.s * max(0, v.cap - v.c) * v.m])


def timeline(v):
    bal, infl, contrib = v.bal, 1.0, v.c
    retire_bal = v.bal if v.retire <= v.age else None
    dep, total, first = -1.0, 0.0, 0.0
    for age in range(int(v.age), int(v.plan)):
        working = age < v.retire
        if age == int(v.retire):
            retire_bal = bal
        add = contrib if working else 0.0
        need = 0.0 if working else v.spend * infl
        income = v.other * infl if (not working and age >= v.oage) else 0.0
        draw = max(0.0, need - income)
        if draw > bal + add:
            draw = bal + add
            dep = float(age) if dep < 0 else dep
        if age == int(v.retire):
            first = draw
        bal = (bal + add - draw) * (1 + (v.rpre if working else v.rpost))
        total += draw
        infl *= 1 + v.infl
        contrib *= 1 + v.cg
    return [bal if retire_bal is None else retire_bal, first, bal, dep, total]


ind("retirement_timeline", "Separate year-by-year implementation", cases=[
    dict(spend=400000.0), dict(retire=45), dict(rpre=0.0, rpost=0.0, infl=0.0, cg=0.0), dict(rpre=-0.03, rpost=-0.03),
    dict(plan=120), dict(other=0.0), dict(oage=60), dict(bal=0.0, c=0.0)])(timeline)
ind("growth_schedule", "Closed-form future value (the app simulates month by month)", cases=[dict(r=0.0), dict(r=-0.1), dict(y=100), dict(m=0.0), dict(infl=0.0)])(
    lambda v: (lambda N, i: (lambda b: [b, v.p + v.m * N, b - v.p - v.m * N, b / (1 + v.infl) ** v.y])(
        v.p + v.m * N if i == 0 else v.p * (1 + i) ** N + v.m * ((1 + i) ** N - 1) / i))(v.y * 12, v.r / 12))
@ind("mix_volatility", "Variance built from the covariance matrix", cases=[dict(rho=-1.0), dict(rho=1.0), dict(we=0.0, wb=1.0), dict(we=0.3, wb=0.3), dict(we=0.0, wb=0.0)])
def _(v):
    w, s = [v.we, v.wb], [v.sa, v.sb]
    cov = [[s[i] * s[j] * (1 if i == j else v.rho) for j in range(2)] for i in range(2)]
    var = sum(w[i] * w[j] * cov[i][j] for i in range(2) for j in range(2))
    stock_part = sum(w[0] * w[j] * cov[0][j] for j in range(2))
    return [math.sqrt(var), v.v * math.sqrt(var), stock_part / var if var > 0 else 0.0]
@ind("portfolio_stress", "Position-by-position accounting", cases=[
    dict(we=0.4, wb=0.6), dict(eq=-0.5), dict(eq=0.25, dy=-0.02), dict(we=0.5, wb=0.3, w=100000.0), dict(we=1.0, wb=0.0), dict(we=0.0, wb=0.0), dict(dy=0.0, infl=0.0)])
def _(v):
    stocks, bonds = v.v * v.we, v.v * v.wb
    cash = v.v - stocks - bonds
    s2, b2 = stocks * (1 + v.eq), bonds * (1 - v.dur * v.dy)
    total = s2 + b2 + cash
    after = total - v.w
    return [s2 - stocks, b2 - bonds, total - v.v, (total - v.v) / v.v, after, after / (1 + v.infl), s2 / total, v.we * after - s2, v.wb * after - b2]

# Tax (independent source: the IRS's printed tables)
ind("income_tax", "IRS Rev. Proc. 2025-32 printed table: base amount + rate × excess", cases=[
    dict(ti=t, status=s) for s in (1, 2, 3) for t in (1.0, 12400.0, 24800.0, 67450.0, 100800.0, 105700.0, 250000.0, 640600.0, 768700.0, 5000000.0)])(
    lambda v: [irs_tax(v.ti, v.status), irs_marginal(v.ti, v.status), irs_tax(v.ti, v.status) / v.ti if v.ti > 0 else 0.0, irs_room(v.ti, v.status)])
@ind("taxable_income", "IRS standard deduction amounts and printed tax table", cases=[dict(status=1), dict(status=3), dict(it=60000.0), dict(g=10000.0)])
def _(v):
    ded = max(v.it, STD_2026[int(v.status)])
    ti = max(0.0, v.g - ded)
    return [ded, ti, irs_tax(ti, v.status)]
ind("after_tax_return", DEF)(lambda v: [v.r * (1 - v.t)])
ind("tey", SOLVE)(lambda v: [bisect(lambda y: y * (1 - v.t) - v.y, -1, 100)])
ind("ltcg_tax", "Cumulative-schedule difference using IRS thresholds", cases=[
    dict(ord=0.0, gain=50000.0), dict(ord=0.0, gain=98900.0), dict(ord=50000.0, gain=100000.0), dict(ord=600000.0, gain=100000.0),
    dict(ord=0.0, gain=1000000.0), dict(ord=40000.0, gain=600000.0, status=1), dict(ord=60000.0, gain=20000.0, status=3), dict(gain=0.0)])(
    lambda v: (lambda t: [t, t / v.gain if v.gain > 0 else 0.0])(ltcg_cumulative(v.ord + v.gain, v.status) - ltcg_cumulative(v.ord, v.status)))
ind("niit", "IRS statutory thresholds", cases=[dict(magi=240000.0), dict(magi=1000000.0), dict(status=1), dict(nii=0.0)])(
    lambda v: [0.038 * min(v.nii, max(0, v.magi - NIIT_THR[int(v.status)])), max(0, v.magi - NIIT_THR[int(v.status)])])
ind("roth_vs_trad", SIM, cases=[dict(tn=0.24, tr=0.24), dict(r=0.0), dict(tn=0.12, tr=0.32)])(
    lambda v: (lambda t, r: [t, r, r - t])(grow(v.c, v.r, v.n) * (1 - v.tr), grow(v.c * (1 - v.tn), v.r, v.n)))
ind("roth_conversion", "IRS printed tax table", cases=[dict(x=0.0), dict(x=500000.0), dict(status=1), dict(ti=800000.0, x=100000.0)])(
    lambda v: (lambda extra: [extra, extra / v.x if v.x > 0 else 0.0, irs_room(v.ti, v.status), irs_marginal(v.ti + v.x, v.status)])(
        irs_tax(v.ti + v.x, v.status) - irs_tax(v.ti, v.status)))
@ind("tlh", "Step-by-step netting", cases=[dict(loss=10000.0), dict(gains=0.0), dict(loss=26000.0)])
def _(v):
    offset = min(v.loss, v.gains)
    rest = v.loss - offset
    ordinary = min(3000, rest)
    return [offset * v.cg + ordinary * v.ord, rest - ordinary]
@ind("tax_deferral", SIM, cases=[dict(t=0.0), dict(r=0.0), dict(r=-0.03), dict(n=50)])
def _(v):
    taxable = v.a
    for _ in range(int(v.n)):
        taxable += taxable * v.r * (1 - v.t)
    gross = grow(v.a, v.r, v.n)
    deferred = gross - (gross - v.a) * v.t
    return [taxable, deferred, deferred - taxable]

# Portfolio & risk
ind("weighted_return", "Explicit sums")(lambda v: [sum(w * r / 100 for w, r in zip(v.w, v.r)) / sum(v.w)])
@ind("two_asset", "Variance built from the covariance matrix", cases=[dict(rho=-1.0), dict(w=0.0), dict(w=1.0)])
def _(v):
    w, s = [v.w, 1 - v.w], [v.sa, v.sb]
    var = sum(w[i] * w[j] * s[i] * s[j] * (1 if i == j else v.rho) for i in range(2) for j in range(2))
    return [v.w * v.ra + (1 - v.w) * v.rb, math.sqrt(max(var, 0.0))]
ind("sharpe", DEF)(lambda v: [(v.r - v.rf) / v.sd])
ind("sortino", DEF)(lambda v: [(v.r - v.t) / v.dd])
ind("capm", DEF)(lambda v: [v.rf + v.b * (v.rm - v.rf)])
ind("rebalance", DEF, cases=[dict(a=900000.0)])(lambda v: [v.a / v.v, v.a / v.v - v.t, v.v * v.t - v.a])
ind("drawdown", SOLVE, cases=[dict(l=0.5), dict(l=0.9)])(
    lambda v: [bisect(lambda g: (1 - v.l) * (1 + g) - 1, 0, 1e6), bisect(lambda n: (1 - v.l) * (1 + v.r) ** n - 1, 0, nmax(v.r))])
ind("hpr", SOLVE, cases=[dict(e=80000.0), dict(n=0.5)])(
    lambda v: [(v.e + v.i - v.b) / v.b, bisect(lambda x: v.b * (1 + x) ** v.n - (v.e + v.i), -0.999999, 1e4)])
@ind("irr", "Independent root search on net present value (NPV at the answer must be zero)", tol=1e-8, cases=[
    dict(cf=[-1000.0, 1100.0]), dict(cf=[-1000.0, 0.0, 0.0, 0.0, 800.0]), dict(cf=[-100.0, 20.0, 30.0, 40.0, 50.0, 60.0]), dict(cf=[500.0, -100.0, -100.0, -100.0, -100.0, -150.0])])
def _(v):
    npv = lambda r: sum(c / (1 + r) ** t for t, c in enumerate(v.cf))
    # secant-free scan for the sign change, then bisection
    grid = [-0.99 + k * 0.001 for k in range(0, 12000)]
    for a, b in zip(grid, grid[1:]):
        if (npv(a) > 0) != (npv(b) > 0):
            return [bisect(npv, a, b)]
    return [float("nan")]
ind("dca", "Explicit share counting")(lambda v: (lambda sh: [sh, sum(v.a) / sh, st.mean(v.p)])(sum(a / p for a, p in zip(v.a, v.p))))

# Fees & costs
ind("fee_drag", SIM, cases=[dict(f=0.0), dict(n=50), dict(r=0.0)])(
    lambda v: (lambda a, b: [a, b, a - b, 1 - b / a])(grow(v.a, v.r, v.n), grow(v.a, v.r - v.f, v.n)))
ind("fee_compare", SIM)(lambda v: (lambda a, b: [a, b, b - a])(grow(v.a, v.r - v.f1, v.n), grow(v.a, v.r - v.f2, v.n)))
ind("aum_vs_flat", DEF)(lambda v: [v.v * v.f, v.v * v.f - v.flat, bisect(lambda x: x * v.f - v.flat, 0, 1e13), v.flat / v.v])
@ind("tiered_fee", "Tier-by-tier slices", cases=[dict(v=500000.0), dict(v=1000000.0), dict(v=5000000.0), dict(v=50000000.0)])
def _(v):
    fee, prev = 0.0, 0.0
    for top, rate in ((v.b1, v.f1), (v.b2, v.f2), (float("inf"), v.f3)):
        if v.v > prev:
            fee += (min(v.v, top) - prev) * rate
        prev = top
    return [fee, fee / v.v]
ind("front_load", SOLVE)(lambda v: [v.a - v.a * v.l, v.a * v.l, bisect(lambda g: (v.a - v.a * v.l) * (1 + g) - v.a, 0, 100)])

# Stocks & bonds
BOND_CASES = [dict(ytm=0.0), dict(ytm=-0.01), dict(cpn=0.0), dict(years=30), dict(freq=1), dict(freq=12), dict(ytm=0.045), dict(years=0.5)]
ind("bond_price", "Sum of discounted coupon and principal cash flows", cases=BOND_CASES)(
    lambda v: (lambda p: [p, p / v.face, v.face * v.cpn / p, p - v.face])(bond_cashflow_price(v.face, v.cpn, v.ytm, v.years, v.freq)))
ind("bond_ytm", "Bisection on the cash-flow price", tol=1e-8, cases=[dict(price=1000.0), dict(price=1200.0), dict(cpn=0.0, price=700.0), dict(years=30), dict(freq=1)])(
    lambda v: [bisect(lambda y: bond_cashflow_price(v.face, v.cpn, y, v.years, v.freq) - v.price, -0.49, 0.99), v.face * v.cpn / v.price])
@ind("bond_duration", "Numerical derivatives of the cash-flow price (central differences)", tol=2e-6,
     cases=[dict(cpn=0.0), dict(years=30), dict(freq=1), dict(dy=-0.02), dict(ytm=0.0001), dict(years=1)])
def _(v):
    P = lambda y: bond_cashflow_price(v.face, v.cpn, y, v.years, v.freq)
    h, p0 = 1e-4, P(v.ytm)
    mod = -(P(v.ytm + h) - P(v.ytm - h)) / (2 * h) / p0
    conv = (P(v.ytm + h) + P(v.ytm - h) - 2 * p0) / (h * h) / p0
    return [mod * (1 + v.ytm / v.freq), mod, conv, -mod * v.dy + 0.5 * conv * v.dy ** 2, P(v.ytm + v.dy) / p0 - 1]
ind("tbill", DEF, cases=[dict(days=182), dict(days=364)])(
    lambda v: (lambda d: [d / v.face * 360 / v.days, d / v.price * 365 / v.days, d / v.price * 360 / v.days, d])(v.face - v.price))
ind("stock_valuation", DEF, cases=[dict(eps=-2.0), dict(div=0.0)])(
    lambda v: [v.div / v.price, v.price / v.eps if v.eps > 0 else float("nan"), v.eps / v.price, v.div / v.eps if v.eps > 0 else float("nan")])
@ind("position_pl", SOLVE, cases=[dict(price=90.0), dict(years=0.5)])
def _(v):
    mv, basis = v.shares * v.price, v.shares * v.cost
    return [mv, mv - basis, (mv + v.divs - basis) / basis, bisect(lambda x: basis * (1 + x) ** v.years - (mv + v.divs), -0.999999, 1e4)]
@ind("dividend_income", "Year-by-year income list", cases=[dict(g=0.0), dict(g=-0.05), dict(n=40)])
def _(v):
    inc = [v.amt * v.y]
    for _ in range(int(v.n) - 1):
        inc.append(inc[-1] * (1 + v.g))
    return [inc[0], inc[-1], sum(inc), inc[-1] / v.amt]
@ind("ddm", "Long sum of discounted growing dividends; bisection for the implied return", tol=1e-8, cases=[dict(g=0.0), dict(g=-0.02), dict(r=0.12)])
def _(v):
    fair = sum(v.d0 * ((1 + v.g) / (1 + v.r)) ** k for k in range(1, 20000))
    implied = bisect(lambda r: v.d0 * (1 + v.g) / (r - v.g) - v.price, v.g + 1e-9, 50)
    return [v.d0 * (1 + v.g), fair, v.price / fair, implied]
ind("position_size", "Integer share arithmetic", cases=[dict(held=300.0), dict(price=7.13)])(
    lambda v: (lambda n: [v.v * v.w, n, n - v.held, (n - v.held) * v.price])(float(int(v.v * v.w // v.price))))

# Statistics & econometrics (Python's statistics library and numerical integration)
ind("descriptive", "Python statistics library")(lambda v: [len(v.x), st.mean(v.x), st.median(v.x), st.stdev(v.x), st.variance(v.x),
                                                         st.stdev(v.x) / math.sqrt(len(v.x)), min(v.x), max(v.x), st.stdev(v.x) / st.mean(v.x)])
ind("normal_prob", "Numerical integration of the normal density", tol=1e-9, cases=[dict(v=70.0), dict(v=100.0), dict(v=160.0)])(
    lambda v: (lambda z: [z, phi(z), 1 - phi(z), 2 * (1 - phi(abs(z)))])((v.v - v.m) / v.s))
ind("normal_between", "Numerical integration of the normal density", cases=[dict(a=70.0, b=130.0), dict(a=100.0, b=101.0)])(
    lambda v: (lambda p: [p, 1 - p])(simpson(lambda x: math.exp(-((x - v.m) / v.s) ** 2 / 2) / (v.s * math.sqrt(2 * math.pi)), v.a, v.b)))
ind("inverse_normal", "Bisection on numerically integrated normal and t distributions", tol=1e-7, cases=[dict(c=0.90), dict(c=0.99), dict(df=1), dict(df=5), dict(df=120)])(
    lambda v: [bisect(lambda z: phi(z) - (1 - (1 - v.c) / 2), 0, 10), bisect(lambda t: t_cdf(t, v.df) - (1 - (1 - v.c) / 2), 0, 700),
               bisect(lambda z: phi(z) - v.c, 0, 10), bisect(lambda t: t_cdf(t, v.df) - v.c, 0, 400)])
ind("pvalue", "Numerical integration of the t and normal densities", tol=1e-8, cases=[dict(stat=-1.2), dict(stat=0.0), dict(df=3), dict(stat=5.0, df=60)])(
    lambda v: [2 * (1 - t_cdf(abs(v.stat), v.df)), 1 - t_cdf(v.stat, v.df), 2 * (1 - phi(abs(v.stat))), 1 - phi(v.stat)])


def t_star(c, df):
    return bisect(lambda t: t_cdf(t, df) - (1 - (1 - c) / 2), 0, 700)


def z_star(c):
    return bisect(lambda z: phi(z) - (1 - (1 - c) / 2), 0, 10)


ind("ci_mean_data", "statistics library + numerically integrated t distribution", tol=1e-7, cases=[dict(c=0.99)])(
    lambda v: (lambda m, e: [m, e, m - e, m + e])(st.mean(v.x), t_star(v.c, len(v.x) - 1) * st.stdev(v.x) / math.sqrt(len(v.x))))
ind("ci_mean_summary", "Numerically integrated t distribution", tol=1e-7, cases=[dict(n=5), dict(c=0.90)])(
    lambda v: (lambda e: [e, v.m - e, v.m + e, v.s / math.sqrt(v.n)])(t_star(v.c, v.n - 1) * v.s / math.sqrt(v.n)))
ind("ci_proportion", "Numerically integrated normal distribution", tol=1e-7, cases=[dict(k=30.0, n=40.0)])(
    lambda v: (lambda p: (lambda e: [p, e, p - e, p + e])(z_star(v.c) * math.sqrt(p * (1 - p) / v.n)))(v.k / v.n))
ind("sample_size", "Numerically integrated normal distribution", tol=1e-9, cases=[dict(c=0.99), dict(p=0.2, ep=0.05)])(
    lambda v: [math.ceil((z_star(v.c) * v.s / v.e) ** 2 - 1e-9), math.ceil(z_star(v.c) ** 2 * v.p * (1 - v.p) / v.ep ** 2 - 1e-9)])
ind("t_test_one", "statistics library + numerically integrated t distribution", tol=1e-8, cases=[dict(mu=3.4), dict(mu=5.0)])(
    lambda v: (lambda t, df: [t, df, 2 * (1 - t_cdf(abs(t), df))])((st.mean(v.x) - v.mu) / (st.stdev(v.x) / math.sqrt(len(v.x))), len(v.x) - 1))
@ind("t_test_two", "Welch statistic from first principles + numerically integrated t distribution", tol=1e-8)
def _(v):
    a, b = st.variance(v.x) / len(v.x), st.variance(v.y) / len(v.y)
    t = (st.mean(v.x) - st.mean(v.y)) / math.sqrt(a + b)
    df = (a + b) ** 2 / (a * a / (len(v.x) - 1) + b * b / (len(v.y) - 1))
    return [st.mean(v.x) - st.mean(v.y), t, df, 2 * (1 - t_cdf(abs(t), df))]


def regression(x, y):
    fit = st.linear_regression(x, y)
    resid = [yi - (fit.intercept + fit.slope * xi) for xi, yi in zip(x, y)]
    n, mx = len(x), st.mean(x)
    sxx = sum((xi - mx) ** 2 for xi in x)
    se = math.sqrt(sum(e * e for e in resid) / (n - 2))
    return fit.slope, fit.intercept, se, sxx, n, mx


@ind("correlation", "Python statistics library", tol=1e-8, cases=[dict(y=[5.0, 3.0, 8.0, 1.0, 9.0, 4.0, 7.0, 2.0, 6.0, 5.5])])
def _(v):
    r, n = st.correlation(v.x, v.y), len(v.x)
    return [r, r * r, st.covariance(v.x, v.y), 2 * (1 - t_cdf(abs(r * math.sqrt((n - 2) / (1 - r * r))), n - 2))]
@ind("ols", "statistics.linear_regression and explicit residuals", tol=1e-8, cases=[dict(y=[5.0, 3.0, 8.0, 1.0, 9.0, 4.0, 7.0, 2.0, 6.0, 5.5])])
def _(v):
    b, a, se, sxx, n, _mx = regression(v.x, v.y)
    seb = se / math.sqrt(sxx)
    return [b, a, st.correlation(v.x, v.y) ** 2, seb, b / seb, 2 * (1 - t_cdf(abs(b / seb), n - 2)), se]
@ind("ols_predict", "statistics.linear_regression and explicit residuals", tol=1e-7, cases=[dict(x0=5.5), dict(c=0.99)])
def _(v):
    b, a, se, sxx, n, mx = regression(v.x, v.y)
    t = t_star(v.c, n - 2)
    lever = 1 / n + (v.x0 - mx) ** 2 / sxx
    return [a + b * v.x0, t * se * math.sqrt(1 + lever), t * se * math.sqrt(lever)]
ind("f_test", "Numerical integration of the F density (upper tail)", tol=1e-8, cases=[dict(r2=0.1, k=2.0, n=30.0), dict(r2=0.05, k=4.0, n=200.0)])(
    lambda v: (lambda F: [F, f_tail(F, v.k, v.n - v.k - 1), 1 - (1 - v.r2) * (v.n - 1) / (v.n - v.k - 1)])((v.r2 / v.k) / ((1 - v.r2) / (v.n - v.k - 1))))
ind("durbin_watson", "Explicit sums")(lambda v: (lambda d: [d, 1 - d / 2])(
    sum((b - a) ** 2 for a, b in zip(v.e, v.e[1:])) / sum(e * e for e in v.e)))
ind("log_coef", DEF, cases=[dict(b=-0.3, d=10.0)])(lambda v: [math.exp(v.b * v.d) - 1, v.b * v.d, v.b * math.log(1 + v.d / 100), (1 + v.d / 100) ** v.b - 1])
@ind("binomial", "Exact rational arithmetic with math.comb", cases=[dict(k=0.0), dict(k=20.0), dict(n=200.0, k=60.0), dict(p=0.5)])
def _(v):
    n, k, p = int(v.n), int(v.k), Fraction(v.p).limit_denominator(10 ** 9)
    pmf = lambda j: math.comb(n, j) * p ** j * (1 - p) ** (n - j)
    return [float(pmf(k)), float(sum(pmf(j) for j in range(k + 1))), float(sum(pmf(j) for j in range(k, n + 1))), n * v.p, math.sqrt(n * v.p * (1 - v.p))]

# Economics
ind("elasticity", DEF)(lambda v: (lambda dq, dp: [dq / dp, dq, dp, v.p2 * v.q2 - v.p1 * v.q1])(
    (v.q2 - v.q1) / ((v.q1 + v.q2) / 2), (v.p2 - v.p1) / ((v.p1 + v.p2) / 2)))
@ind("market_equilibrium", "Bisection for the market-clearing quantity; triangle areas", cases=[dict(t=0.0), dict(t=30.0), dict(b=0.5, d=3.0)])
def _(v):
    q = bisect(lambda q: (v.a - v.b * q) - (v.c + v.d * q), 0, 1e9)
    p = v.a - v.b * q
    qt = bisect(lambda q: (v.a - v.b * q) - (v.c + v.d * q + v.t), 0, 1e9)
    pb = v.a - v.b * qt
    return [q, p, 0.5 * (v.a - p) * q, 0.5 * (p - v.c) * q, qt, pb, pb - v.t, v.t * qt, 0.5 * v.t * (q - qt), v.b / (v.b + v.d) if v.t == 0 else (pb - p) / v.t]
ind("cpi_inflation", DEF)(lambda v: [v.c1 / v.c0 - 1, v.v * v.c1 / v.c0, v.v * v.c0 / v.c1])
ind("gdp_deflator", DEF)(lambda v: [v.ng / v.rg * 100, v.ng / v.ng0 - 1, v.rg / v.rg0 - 1, (v.ng / v.rg) / (v.ng0 / v.rg0) - 1])
ind("rule70", SOLVE)(lambda v: [70 / (v.g * 100), bisect(lambda n: (1 + v.g) ** n - 2, 0, nmax(v.g)), bisect(lambda n: (1 + v.g) ** n - v.m, 0, nmax(v.g))])
@ind("multiplier", "Sum of the spending-round geometric series", cases=[dict(t=0.25), dict(dt=50.0), dict(mpc=0.5)])
def _(v):
    k = sum((v.mpc * (1 - v.t)) ** j for j in range(20000))
    return [k, -v.mpc * k, v.dg * k - v.dt * v.mpc * k, 1 - v.mpc]
ind("money", "Sum of the deposit-expansion series", tol=1e-8)(
    lambda v: (lambda k: [k, v.dep * k, (1 + v.gm) * (1 + v.gv) / (1 + v.gy) - 1, v.gm + v.gv - v.gy])(sum((1 - v.rr) ** j for j in range(5000))))
ind("taylor_rule", DEF)(lambda v: (lambda real: [real + v.pi, real])(v.rn + v.wp * (v.pi - v.pit) + v.wy * v.gap))
ind("labor_market", DEF)(lambda v: [v.u / (v.u + v.e), (v.u + v.e) / v["pop"], v.e / v["pop"], v.u + v.e])
ind("okun", DEF)(lambda v: [-v.k * (v.u - v.un), -v.k * (v.u - v.un) * v.yp])
@ind("monopoly", "Numerical profit maximization (ternary search), no calculus", tol=1e-6, cases=[dict(mc=0.0), dict(b=0.25)])
def _(v):
    profit = lambda q: (v.a - v.b * q) * q - v.mc * q - v.fc
    lo, hi = 0.0, v.a / v.b
    for _ in range(300):
        m1, m2 = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        lo, hi = (m1, hi) if profit(m1) < profit(m2) else (lo, m2)
    q = (lo + hi) / 2
    p, qc = v.a - v.b * q, (v.a - v.mc) / v.b
    return [q, p, profit(q), qc, 0.5 * (p - v.mc) * (qc - q), (p - v.mc) / p]
ind("costs", DEF)(lambda v: [(v.vc2 - v.vc1) / (v.q2 - v.q1), (v.fc + v.vc2) / v.q2, v.vc2 / v.q2, v.fc / v.q2])
ind("hhi", "Explicit sums", cases=[dict(s=[100.0]), dict(s=[10.0] * 10), dict(s=[5.0, 40.0, 15.0, 30.0, 10.0])])(
    lambda v: [sum(x * x for x in v.s), sum(sorted(v.s)[-4:]) / 100, sum(v.s) / 100])
@ind("cobb_douglas", "Marginal products by numerical differentiation", tol=1e-6)
def _(v):
    Y = lambda K, L: v.A * K ** v.al * L ** (1 - v.al)
    h = 1e-4
    return [Y(v.K, v.L), (Y(v.K + h, v.L) - Y(v.K - h, v.L)) / (2 * h), (Y(v.K, v.L + h) - Y(v.K, v.L - h)) / (2 * h), Y(v.K, v.L) / v.L,
            v.gy - v.al * v.gk - (1 - v.al) * v.gl]
ind("comparative_advantage", DEF)(lambda v: [v.ay / v.ax, v.by / v.bx, v.ax / v.ay, v.bx / v.by])

# Planning & protection
ind("net_worth", DEF)(lambda v: (lambda assets, debts: [assets - debts, assets, debts / assets, (v.cash + v.inv) / assets])(
    v.cash + v.inv + v.ret + v.re + v.oth, v.mort + v.debt))
ind("savings_rate", DEF)(lambda v: [v.s / v.i])
ind("emergency_fund", DEF)(lambda v: [v.e * v.m, v.e * v.m - v.h, v.h / v.e])
@ind("college", "Year-by-year costs; bisection on a month-by-month savings simulation", tol=1e-8, cases=[dict(p=0.0), dict(n=18), dict(p=400000.0)])
def _(v):
    cost = sum(grow(v.c, v.i, v.n + k) for k in range(int(v.y)))
    months = int(v.n * 12)
    m = bisect(lambda m: accumulate(v.p, m, v.r / 12, months) - cost, -1e8, 1e8)
    return [cost, accumulate(v.p, 0.0, v.r / 12, months), max(0.0, m)]
ind("life_insurance", "Sum of discounted income", cases=[dict(r=0.0), dict(cov=5000000.0)])(
    lambda v: (lambda pv: [max(0.0, pv + v.debt + v.edu - v.cov - v.assets), pv])(annuity_pv(v.inc, v.r, v.n)))
@ind("estate_exposure", "IRS Rev. Proc. 2025-32 amounts ($15,000,000 exclusion, $19,000 gift exclusion)", cases=[dict(m=2), dict(e=5000000.0), dict(g=20000000.0)])
def _(v):
    avail = max(0.0, 15_000_000 * v.m - v.g)
    over = max(0.0, v.e - avail)
    return [avail, over, 0.40 * over, 19000.0]
ind("debt_vs_invest", DEF)(lambda v: [v.d * (1 - v.dt), v.r * (1 - v.t), v.r * (1 - v.t) - v.d * (1 - v.dt)])
@ind("loan_payment", "Bisection on a month-by-month amortization to a zero balance", tol=1e-8, cases=[dict(r=0.0), dict(y=40), dict(r=0.18, y=5)])
def _(v):
    months = int(v.y * 12)
    def left(pay):
        bal = v.p
        for _ in range(months):
            bal = bal * (1 + v.r / 12) - pay
        return bal
    pay = bisect(left, 0, v.p * 2)
    return [pay, pay * months - v.p]


# ── Monte Carlo: deterministic limits and sampling theory ────────────────────────
def custom_checks():
    out = []

    def check(name, ok, detail=""):
        out.append((name, bool(ok), detail))

    mc, rmc = CATALOG["monte_carlo"], CATALOG["retirement_mc"]
    # 1. With zero volatility the simulation must equal a plain deterministic projection.
    for label, over in (("sustainable", dict(w=60000.0)), ("depleting", dict(w=200000.0))):
        v = example_inputs(mc); v.update(sd=0.0, sims=200.0, **over)
        bal, w, ok = v.bal, v.w, True
        for _ in range(int(v.years)):
            if bal < w:
                bal, ok = 0.0, False
                break
            bal = (bal - w) * (1 + v.mean)
            w *= 1 + v.infl
        got = app_eval(mc, v)
        want = [1.0 if ok else 0.0, bal, bal, bal]
        check(f"Monte Carlo withdrawal test, zero volatility ({label}) equals the deterministic path",
              all(abs(g - x) <= 1e-9 * max(1, abs(x)) for g, x in zip(got, want)), f"{got} vs {want}")
    for label, over in (("base", {}), ("depleting", dict(spend=300000.0)), ("already retired", dict(age=66, retire=66))):
        v = example_inputs(rmc); v.update(sd=0.0, sims=200.0, **over)
        t = timeline(v)
        got = app_eval(rmc, v)
        want = [1.0 if t[3] < 0 else 0.0, t[0], t[2], t[2], t[2]]
        if t[3] >= 0:   # after depletion both report a zero balance
            want[2:] = [0.0, 0.0, 0.0]
        check(f"Retirement Monte Carlo, zero volatility ({label}) equals the Retirement timeline",
              all(abs(g - x) <= 1e-9 * max(1, abs(x)) for g, x in zip(got, want)), f"{got} vs {want}")
    # 2. The random-number generator: mean 0, standard deviation 1, symmetric, within sampling error.
    rng = bc.SplitMix(2026)
    draws = [rng.normal() for _ in range(400000)]
    n = len(draws)
    mean, sd = st.fmean(draws), st.pstdev(draws)
    check("Normal generator: mean within 4 standard errors of 0", abs(mean) < 4 / math.sqrt(n), f"mean {mean:.5f}")
    check("Normal generator: standard deviation within 0.5% of 1", abs(sd - 1) < 0.005, f"sd {sd:.5f}")
    for z, p in ((-1.2815515655, 0.10), (0.0, 0.50), (1.6448536270, 0.95)):
        frac = sum(1 for d in draws if d < z) / n
        check(f"Normal generator: P(Z < {z:.3f}) = {p:.2f} within 4 standard errors", abs(frac - p) < 4 * math.sqrt(p * (1 - p) / n), f"{frac:.5f}")
    # 3. One-year, no-withdrawal simulation: percentiles must match the normal distribution's.
    v = example_inputs(mc); v.update(w=0.0, years=1.0, sims=20000.0, sd=0.15, mean=0.06, seed=7.0)
    got = app_eval(mc, v)
    B, s, nsim = v.bal, v.sd, v.sims
    dens = lambda z: math.exp(-z * z / 2) / math.sqrt(2 * math.pi)
    for idx, z, p in ((1, -1.2815515655, 0.10), (2, 0.0, 0.50), (3, 1.2815515655, 0.90)):
        want = B * (1 + v.mean + s * z)
        se = B * s * math.sqrt(p * (1 - p) / nsim) / dens(z)
        check(f"Monte Carlo one-year percentile {int(p * 100)} matches theory within 4 standard errors", abs(got[idx] - want) < 4 * se,
              f"{got[idx]:,.0f} vs {want:,.0f} (se {se:,.0f})")
    check("Monte Carlo with no withdrawals never fails", got[0] == 1.0)
    # 4. More volatility can only lower a 100%-funded plan's success rate; results are reproducible by seed.
    v = example_inputs(mc)
    a = app_eval(mc, v); b = app_eval(mc, v)
    check("Monte Carlo is reproducible for a given seed", a == b)
    v2 = V(v); v2.update(seed=43.0)
    check("A different seed gives a different draw", app_eval(mc, v2) != a)
    lo = V(v); lo.update(sd=0.04)
    check("Lower volatility raises the success rate in the example", app_eval(mc, lo)[0] > a[0], f"{app_eval(mc, lo)[0]} vs {a[0]}")
    return out


# ── Run ────────────────────────────────────────────────────────────────────────
def same(a, b, tol):
    if a is None or b is None:
        return True
    if isinstance(b, float) and math.isnan(b):
        return isinstance(a, float) and math.isnan(a)
    if isinstance(a, float) and math.isnan(a):
        return False
    return abs(a - b) <= tol * max(1.0, abs(b))


STAT_ONLY = {
    "monte_carlo": "Deterministic limit (zero volatility), sampling theory for percentiles, generator statistics, seed reproducibility",
    "retirement_mc": "Deterministic limit equals the independently verified Retirement timeline; shares the verified generator",
}


def main():
    rows, failures, n_checks, n_cases = [], [], 0, 0
    for cid, calc in CATALOG.items():
        if cid in STAT_ONLY:
            rows.append((calc["category"], calc["name"], len(calc["outputs"]), "—", STAT_ONLY[cid], "Verified statistically (see Monte Carlo checks)"))
            continue
        if cid not in IND:
            failures.append(f"{cid}: no independent check")
            rows.append((calc["category"], calc["name"], len(calc["outputs"]), 0, "none", "NOT VERIFIED"))
            continue
        spec_ = IND[cid]
        base = example_inputs(calc)
        ok = True
        cases = [base] + [V({**base, **c}) for c in spec_["cases"]]
        for i, v in enumerate(cases):
            got = app_eval(calc, v)
            want = spec_["fn"](v)
            if len(got) != len(want):
                failures.append(f"{cid}: independent check returns {len(want)} values for {len(got)} outputs")
                ok = False
                continue
            for o, g, w in zip(calc["outputs"], got, want):
                n_checks += 1
                if not same(g, w, spec_["tol"]):
                    ok = False
                    failures.append(f"{cid} case {i} “{o['label']}”: app {g!r} vs independent {w!r}  inputs {dict(v) if i else 'example'}")
        n_cases += len(cases)
        rows.append((calc["category"], calc["name"], len(calc["outputs"]), len(cases), spec_["how"], "Verified" if ok else "FAILED"))
    custom = custom_checks()
    for name, ok, detail in custom:
        n_checks += 1
        if not ok:
            failures.append(f"Monte Carlo: {name} ({detail})")

    doc = ["# Wealth Desk accuracy audit", "",
           "Generated by `tools/audit.py`. Every calculator output is recomputed by an independent method (not the app's formula, not the",
           "reference engine's financial functions) and compared with the app's result at the example inputs and at edge cases.",
           "`wdcheck` separately proves the shipped Swift engine reproduces the reference engine on every output.", "",
           f"**Result: {len(CATALOG)} calculators, {n_cases} input cases, {n_checks} independent comparisons, {len(failures)} failures.**", "",
           "Tolerance is 1e-9 relative unless the independent method is itself numerical (integration, numerical derivatives), where it is 1e-6 to 1e-8.", "",
           "| Category | Calculator | Outputs | Cases | Independent method | Status |", "| --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        doc.append("| " + " | ".join(str(x) for x in r) + " |")
    doc += ["", "## Monte Carlo checks", ""]
    doc += [f"- {'PASS' if ok else 'FAIL'}: {name}" + (f" ({detail})" if detail and not ok else "") for name, ok, detail in custom]
    doc += ["", "## What this audit does not cover", "",
            "- **Model risk.** A verified formula is still a simplification. Each calculator states its assumptions (for example, the stress test's",
            "  duration approximation, normally distributed Monte Carlo returns, federal-only tax). Those are documented, not removed.",
            "- **Tax law beyond the implemented rules.** State tax, AMT, credits, phase-outs and payroll taxes are not modeled.",
            "- **2027 retirement-plan limits.** The IRS had not published them when the tax table was last verified, so the 2027 table uses 2026 limits and says so.",
            "- **Monte Carlo example values.** Seeded example outputs are checked for engine parity and statistical validity, not against a second random stream."]
    if failures:
        doc += ["", "## Failures", ""] + [f"- {f}" for f in failures]
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    open(os.path.join(ROOT, "docs", "ACCURACY_AUDIT.md"), "w").write("\n".join(doc) + "\n")
    print(f"Audit: {len(CATALOG)} calculators, {n_cases} cases, {n_checks} independent comparisons, {len(failures)} failures")
    for f in failures[:60]:
        print("  FAIL", f)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
