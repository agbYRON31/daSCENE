// Wealth Desk engine, JavaScript port of Sources/WealthCore (Expression, Engine, Finance,
// Stats, Scientific, TaxTable, Projections). Mirrors the Swift code operation for operation;
// web/check.mjs runs every catalog example against its Python-computed expected value.

export class EvalError extends Error {}
const fail = (m) => { throw new EvalError(m); };

// Swift's Double.rounded(): half away from zero.
const roundHalfAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
const trunc = Math.trunc;

// ---------------------------------------------------------------------------
// Special functions (erfc, lgamma) not built into JS

// W. J. Cody's rational Chebyshev approximations (as in netlib CALERF), ~1e-16 relative.
const ERF_A = [3.16112374387056560e00, 1.13864154151050156e02, 3.77485237685302021e02, 3.20937758913846947e03, 1.85777706184603153e-1];
const ERF_B = [2.36012909523441209e01, 2.44024637934444173e02, 1.28261652607737228e03, 2.84423683343917062e03];
const ERF_C = [5.64188496988670089e-1, 8.88314979438837594e00, 6.61191906371416295e01, 2.98635138197400131e02,
  8.81952221241769090e02, 1.71204761263407058e03, 2.05107837782607147e03, 1.23033935479799725e03, 2.15311535474403846e-8];
const ERF_D = [1.57449261107098347e01, 1.17693950891312499e02, 5.37181101862009858e02, 1.62138957456669019e03,
  3.29079923573345963e03, 4.36261909014324716e03, 3.43936767414372164e03, 1.23033935480374942e03];
const ERF_P = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2,
  6.58749161529837803e-4, 1.63153871373020978e-2];
const ERF_Q = [2.56852019228982242e00, 1.87295284992346725e00, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];
const SQRPI = 5.6418958354775628695e-1;

export function erfc(x) {
  if (Number.isNaN(x)) return NaN;
  const y = Math.abs(x);
  let result;
  if (y <= 0.46875) {
    const ysq = y > 1.11e-16 ? y * y : 0;
    let xnum = ERF_A[4] * ysq, xden = ysq;
    for (let i = 0; i < 3; i++) { xnum = (xnum + ERF_A[i]) * ysq; xden = (xden + ERF_B[i]) * ysq; }
    return 1 - x * (xnum + ERF_A[3]) / (xden + ERF_B[3]);
  } else if (y <= 4) {
    let xnum = ERF_C[8] * y, xden = y;
    for (let i = 0; i < 7; i++) { xnum = (xnum + ERF_C[i]) * y; xden = (xden + ERF_D[i]) * y; }
    result = (xnum + ERF_C[7]) / (xden + ERF_D[7]);
    const ysq = trunc(y * 16) / 16, del = (y - ysq) * (y + ysq);
    result = Math.exp(-ysq * ysq) * Math.exp(-del) * result;
  } else {
    if (y >= 26.543) { result = 0; }
    else {
      const ysq = 1 / (y * y);
      let xnum = ERF_P[5] * ysq, xden = ysq;
      for (let i = 0; i < 4; i++) { xnum = (xnum + ERF_P[i]) * ysq; xden = (xden + ERF_Q[i]) * ysq; }
      result = ysq * (xnum + ERF_P[4]) / (xden + ERF_Q[4]);
      result = (SQRPI - result) / y;
      const ysq2 = trunc(y * 16) / 16, del = (y - ysq2) * (y + ysq2);
      result = Math.exp(-ysq2 * ysq2) * Math.exp(-del) * result;
    }
  }
  return x < 0 ? 2 - result : result;
}

// Lanczos approximation (g = 7, n = 9) for small x; Stirling's series for x ≥ 10, where it is
// accurate to the last bit and avoids the cancellation Lanczos suffers at very large x.
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
const HALF_LOG_2PI = 0.91893853320467274178;
export function lgamma(x) {
  if (x >= 10) {
    const r = 1 / x, r2 = r * r;
    const series = r * (1 / 12 - r2 * (1 / 360 - r2 * (1 / 1260 - r2 * (1 / 1680 - r2 / 1188))));
    return (x - 0.5) * Math.log(x) - x + HALF_LOG_2PI + series;
  }
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ---------------------------------------------------------------------------
// Finance

export const Finance = {
  fv(r, n, pmt, pv) {
    if (r === 0) return pv + pmt * n;
    const g1 = Math.expm1(n * Math.log1p(r));
    return pv * (1 + g1) + pmt * g1 / r;
  },
  pv(r, n, pmt) {
    if (r === 0) return pmt * n;
    return pmt * -Math.expm1(-n * Math.log1p(r)) / r;
  },
  pmt(r, n, pv) {
    if (r === 0) return pv / n;
    return pv * r / -Math.expm1(-n * Math.log1p(r));
  },
  nper(r, pmt, pv, fv) {
    if (r === 0) return (fv - pv) / pmt;
    return Math.log((fv * r + pmt) / (pv * r + pmt)) / Math.log(1 + r);
  },
  rate(n, pmt, pv) {
    let lo = -0.99, hi = 10.0;
    const value = (r) => r !== 0 ? Finance.pv(r, n, pmt) : pmt * n;
    if ((value(lo) > pv) === (value(hi) > pv)) fail("No interest rate between −99% and 1,000% per period fits these inputs.");
    for (let i = 0; i < 400; i++) {
      const mid = (lo + hi) / 2;
      if (value(mid) > pv) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  },
  npv(r, cf) {
    let total = 0;
    cf.forEach((c, t) => { total += c / Math.pow(1 + r, t); });
    return total;
  },
  periods(years, freq) { return Math.floor(years * freq + 0.5); },
  bondPrice(face, cpn, ytm, years, freq) {
    const n = Finance.periods(years, freq), i = ytm / freq, c = face * cpn / freq;
    if (i === 0) return c * n + face;
    return c * (1 - Math.pow(1 + i, -n)) / i + face * Math.pow(1 + i, -n);
  },
  bondYTM(price, face, cpn, years, freq) {
    let lo = -0.5, hi = 1.0;
    if ((Finance.bondPrice(face, cpn, lo, years, freq) > price) === (Finance.bondPrice(face, cpn, hi, years, freq) > price)) {
      fail("No yield between −50% and 100% matches this price.");
    }
    for (let k = 0; k < 300; k++) {
      const mid = (lo + hi) / 2;
      if (Finance.bondPrice(face, cpn, mid, years, freq) > price) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  },
  macaulayDuration(face, cpn, ytm, years, freq) {
    const n = Finance.periods(years, freq);
    if (!(n >= 1)) return NaN;
    const i = ytm / freq, c = face * cpn / freq;
    let total = 0;
    for (let k = 1; k <= n; k++) {
      const cf = c + (k === n ? face : 0);
      total += (k / freq) * cf / Math.pow(1 + i, k);
    }
    return total / Finance.bondPrice(face, cpn, ytm, years, freq);
  },
  convexity(face, cpn, ytm, years, freq) {
    const n = Finance.periods(years, freq);
    if (!(n >= 1)) return NaN;
    const i = ytm / freq, c = face * cpn / freq;
    let total = 0;
    for (let k = 1; k <= n; k++) {
      const cf = c + (k === n ? face : 0);
      total += cf * k * (k + 1) / Math.pow(1 + i, k + 2);
    }
    return total / (Finance.bondPrice(face, cpn, ytm, years, freq) * freq * freq);
  },
  signChanges(cf) {
    let changes = 0, last = null;
    for (const c of cf) {
      if (c === 0) continue;
      const pos = c > 0;
      if (last !== null && last !== pos) changes++;
      last = pos;
    }
    return changes;
  },
  irr(cf) {
    if (cf.length < 2) fail("IRR needs at least two cash flows.");
    const changes = Finance.signChanges(cf);
    if (changes !== 1) {
      fail(changes === 0 ? "IRR needs both money in (negative) and money out (positive)."
        : "These cash flows change sign more than once, so IRR has no single answer.");
    }
    let lo = -0.9999, hi = 10.0;
    let flo = Finance.npv(lo, cf);
    if ((flo > 0) === (Finance.npv(hi, cf) > 0)) fail("The return is outside the −99.99% to 1,000% range IRR can solve.");
    for (let k = 0; k < 300; k++) {
      const mid = (lo + hi) / 2, fm = Finance.npv(mid, cf);
      if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return (lo + hi) / 2;
  },
};

// ---------------------------------------------------------------------------
// Statistics

export const Stats = {
  requireCount(s, n, name) { if (s.length < n) fail(`${name} needs at least ${n} values.`); },
  mean(s) { return s.reduce((a, b) => a + b, 0) / s.length; },
  median(s) {
    Stats.requireCount(s, 1, "Median");
    const v = [...s].sort((a, b) => a - b), n = v.length;
    return n % 2 === 1 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  },
  variance(s) {
    Stats.requireCount(s, 2, "Variance");
    const m = Stats.mean(s);
    let total = 0;
    for (const x of s) total += (x - m) * (x - m);
    return total / (s.length - 1);
  },
  sd(s) { return Math.sqrt(Stats.variance(s)); },
  covariance(a, b) {
    if (a.length !== b.length) fail("Lists must be the same length.");
    Stats.requireCount(a, 2, "Covariance");
    const ma = Stats.mean(a), mb = Stats.mean(b);
    let total = 0;
    for (let i = 0; i < a.length; i++) total += (a[i] - ma) * (b[i] - mb);
    return total / (a.length - 1);
  },
  correlation(a, b) { return Stats.covariance(a, b) / (Stats.sd(a) * Stats.sd(b)); },
  durbinWatson(e) {
    Stats.requireCount(e, 2, "Durbin–Watson");
    let num = 0, den = 0;
    for (let i = 1; i < e.length; i++) num += (e[i] - e[i - 1]) * (e[i] - e[i - 1]);
    for (const x of e) den += x * x;
    return num / den;
  },
  topSum(s, k) {
    return [...s].sort((a, b) => b - a).slice(0, Math.max(0, trunc(k))).reduce((a, b) => a + b, 0);
  },
  normCDF(z) { return 0.5 * erfc(-z / Math.SQRT2); },
  normInv(p) {
    if (!(p > 0 && p < 1)) fail("Probability must be between 0 and 1.");
    let lo = -40, hi = 40;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (Stats.normCDF(mid) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  },
  betacf(a, b, x) {
    const fpmin = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < fpmin) d = fpmin;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
      c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < fpmin) d = fpmin;
      c = 1 + aa / c; if (Math.abs(c) < fpmin) c = fpmin;
      d = 1 / d;
      const de = d * c;
      h *= de;
      if (Math.abs(de - 1) < 3e-16) break;
    }
    return h;
  },
  betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * Stats.betacf(a, b, x) / a;
    return 1 - bt * Stats.betacf(b, a, 1 - x) / b;
  },
  tCDF(t, df) {
    if (!(df > 0)) fail("Degrees of freedom must be positive.");
    const x = df / (df + t * t), p = 0.5 * Stats.betai(df / 2, 0.5, x);
    return t > 0 ? 1 - p : p;
  },
  tInv(p, df) {
    if (!(p > 0 && p < 1)) fail("Probability must be between 0 and 1.");
    let lo = -1000, hi = 1000;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (Stats.tCDF(mid, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  },
  fCDF(f, d1, d2) {
    if (!(d1 > 0 && d2 > 0)) fail("Degrees of freedom must be positive.");
    if (f <= 0) return 0;
    return Stats.betai(d1 / 2, d2 / 2, d1 * f / (d1 * f + d2));
  },
  binomPMF(nD, kD, p) {
    const n = trunc(nD), k = trunc(kD);
    if (k < 0 || k > n) return 0;
    if (p === 0) return k === 0 ? 1 : 0;
    if (p === 1) return k === n ? 1 : 0;
    return Math.exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  },
  binomCDF(n, k, p) {
    let total = 0;
    const kk = trunc(k);
    for (let i = 0; i <= kk; i++) total += Stats.binomPMF(n, i, p);
    return Math.min(1, total);
  },
};

// ---------------------------------------------------------------------------
// Scientific

export const Scientific = {
  wholeNumber(x, name) {
    if (!(x >= 0 && roundHalfAway(x) === x && x <= 170)) fail(`${name} needs a whole number from 0 to 170.`);
    return x;
  },
  factorial(x) {
    const n = Scientific.wholeNumber(x, "Factorial");
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  },
  combinations(nD, kD) {
    const n = Scientific.wholeNumber(nD, "nCr"), k = Scientific.wholeNumber(kD, "nCr");
    if (k > n) return 0;
    const kk = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= kk; i++) r = r * (n - kk + i) / i;
    return roundHalfAway(r);
  },
  permutations(nD, kD) {
    const n = Scientific.wholeNumber(nD, "nPr"), k = Scientific.wholeNumber(kD, "nPr");
    if (k > n) return 0;
    let r = 1;
    for (let i = 0; i < k; i++) r *= n - i;
    return r;
  },
  reserved: new Set(["ans", "pi", "e"]),
  /** One scratchpad line: an expression, or `name = expression`. */
  evaluate(line, variables, ans, degrees, tax) {
    let text = line.trim();
    if (!text) fail("Type an expression.");
    let name = null;
    const eq = text.indexOf("=");
    if (eq > 0 && text[eq + 1] !== "=" && !"<>!=".includes(text[eq - 1])) {
      const lhs = text.slice(0, eq).trim();
      if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(lhs)) fail("Only a name can go on the left of =, like x = 5.");
      if (Scientific.reserved.has(lhs)) fail(`“${lhs}” is built in and can't be reassigned.`);
      name = lhs;
      text = text.slice(eq + 1);
    }
    const scope = { pi: Math.PI, e: Math.E, ...variables };
    if (ans !== null && ans !== undefined) scope.ans = ans;
    const value = new Expression(text).number(scope, tax, degrees);
    if (Number.isNaN(value)) fail("Not a real number (check the inputs, e.g. √ of a negative).");
    if (!Number.isFinite(value)) fail("Result is infinite (division by zero?).");
    return { name, value };
  },
  display(v) {
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1e15 || a < 1e-9) return v.toPrecision(10).replace(/\.?0+e/, "e").replace("e+", "e");
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 10, maximumSignificantDigits: 15, roundingPriority: "lessPrecision" })
      .format(v).replace("-", "−");
  },
};

// ---------------------------------------------------------------------------
// Tax tables

export class TaxTable {
  constructor(json) { Object.assign(this, json); }
  key(status) {
    const k = String(trunc(status));
    if (!this.ordinaryBrackets[k]) fail("Unknown filing status.");
    return k;
  }
  brackets(status) { return this.ordinaryBrackets[this.key(status)]; }
  incomeTax(income, status) {
    const ti = Math.max(0, income), b = this.brackets(status);
    let tax = 0;
    for (let i = 0; i < b.length; i++) {
      const floor = b[i][0], rate = b[i][1], top = i + 1 < b.length ? b[i + 1][0] : Infinity;
      if (ti > floor) tax += (Math.min(ti, top) - floor) * rate;
    }
    return tax;
  }
  marginalRate(income, status) {
    const b = this.brackets(status);
    let rate = b[0][1];
    for (const row of b) if (income >= row[0]) rate = row[1];
    return rate;
  }
  bracketRoom(income, status) {
    const b = this.brackets(status);
    for (let i = 0; i < b.length; i++) {
      if (i + 1 >= b.length) return NaN;
      const top = b[i + 1][0];
      if (income < top) return top - Math.max(income, 0);
    }
    return NaN;
  }
  standardDeductionFor(status) { return this.standardDeduction[this.key(status)]; }
  ltcgTax(ordinary, gain, status) {
    const t = this.ltcgThresholds[this.key(status)], t0 = t[0], t15 = t[1], total = ordinary + gain;
    const in0 = Math.max(0, Math.min(total, t0) - ordinary);
    const in15 = Math.max(0, Math.min(total, t15) - Math.max(ordinary, t0));
    const in20 = Math.max(0, gain - in0 - in15);
    return 0.15 * in15 + 0.20 * in20;
  }
  niitThresholdFor(status) { return this.niitThreshold[this.key(status)]; }
  rmdFactor(age) {
    const f = this.uniformLifetime[String(trunc(age))];
    if (f === undefined) fail("The Uniform Lifetime Table covers ages 72 to 120.");
    return f;
  }
  limit401k(age) {
    const L = this.limits;
    let extra = 0;
    if (age >= 60 && age <= 63) extra = L.catchUp401k60to63; else if (age >= 50) extra = L.catchUp401k50;
    return L.deferral401k + extra;
  }
  limitIRA(age) { return this.limits.ira + (age >= 50 ? this.limits.iraCatchUp50 : 0); }
}

export class TaxData {
  constructor(json) {
    this.referenceYear = json.referenceYear;
    this.tables = json.tables.map((t) => new TaxTable(t));
    if (!this.tables.length) fail("taxdata.json has no tax years.");
  }
  get years() { return this.tables.map((t) => t.taxYear).sort((a, b) => a - b); }
  table(year) { return this.tables.find((t) => t.taxYear === year) || null; }
  defaultYear(today = new Date()) {
    const y = today.getFullYear();
    if (this.table(y)) return y;
    const ys = this.years, before = ys.filter((x) => x <= y);
    return before.length ? before[before.length - 1] : ys[0];
  }
}

// ---------------------------------------------------------------------------
// Expression language

function tokenize(s) {
  const out = [];
  const chars = Array.from(s.replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-").replaceAll("π", "pi"));
  const isDigit = (c) => c !== undefined && /[0-9]/.test(c);
  const isLetter = (c) => c !== undefined && /\p{L}/u.test(c);
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (/\s/.test(c)) { i++; continue; }
    if (isDigit(c) || (c === "." && isDigit(chars[i + 1]))) {
      let j = i;
      while (j < chars.length && (isDigit(chars[j]) || chars[j] === ".")) j++;
      if (chars[j] === "e" || chars[j] === "E") {
        let k = j + 1;
        if (chars[k] === "+" || chars[k] === "-") k++;
        if (isDigit(chars[k])) { j = k; while (isDigit(chars[j])) j++; }
      }
      const text = chars.slice(i, j).join("");
      if (!/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) fail("Bad number in formula.");
      out.push({ t: "num", v: Number(text) }); i = j; continue;
    }
    if (isLetter(c) || c === "_") {
      let j = i;
      while (j < chars.length && (isLetter(chars[j]) || isDigit(chars[j]) || chars[j] === "_")) j++;
      out.push({ t: "ident", v: chars.slice(i, j).join("") }); i = j; continue;
    }
    if (c === "(") { out.push({ t: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")" }); i++; continue; }
    if (c === ",") { out.push({ t: "," }); i++; continue; }
    const two = c + (chars[i + 1] ?? "");
    if (["<=", ">=", "==", "!="].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^<>".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    fail(`Unexpected character “${c}” in formula.`);
  }
  out.push({ t: "end" });
  return out;
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  get peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }
  isOp(...ops) { return this.peek.t === "op" && ops.includes(this.peek.v); }
  comparison() {
    let lhs = this.additive();
    while (this.isOp("<", ">", "<=", ">=", "==", "!=")) { const o = this.next().v; lhs = { k: "bin", op: o, a: lhs, b: this.additive() }; }
    return lhs;
  }
  additive() {
    let lhs = this.multiplicative();
    while (this.isOp("+", "-")) { const o = this.next().v; lhs = { k: "bin", op: o, a: lhs, b: this.multiplicative() }; }
    return lhs;
  }
  multiplicative() {
    let lhs = this.unary();
    while (this.isOp("*", "/")) { const o = this.next().v; lhs = { k: "bin", op: o, a: lhs, b: this.unary() }; }
    return lhs;
  }
  unary() {
    if (this.isOp("-", "+")) {
      const o = this.next().v, operand = this.unary();
      return o === "-" ? { k: "neg", a: operand } : operand;
    }
    return this.power();
  }
  power() {
    const base = this.primary();
    if (this.isOp("^")) { this.next(); return { k: "bin", op: "^", a: base, b: this.unary() }; }
    return base;
  }
  primary() {
    const tok = this.next();
    if (tok.t === "num") return { k: "num", v: tok.v };
    if (tok.t === "ident") {
      if (this.peek.t === "(") {
        this.next();
        const args = [];
        if (this.peek.t !== ")") {
          args.push(this.comparison());
          while (this.peek.t === ",") { this.next(); args.push(this.comparison()); }
        }
        if (this.next().t !== ")") fail("Malformed formula.");
        return { k: "call", name: tok.v.toLowerCase(), args };
      }
      return { k: "var", name: tok.v };
    }
    if (tok.t === "(") {
      const e = this.comparison();
      if (this.next().t !== ")") fail("Malformed formula.");
      return e;
    }
    fail("Malformed formula.");
  }
}

// Values: a number, or an array (a "series").
const isSeries = Array.isArray;
const num = (v, ctx) => { if (isSeries(v)) fail(`${ctx} needs a single number, not a list.`); return v; };
const list = (v) => (isSeries(v) ? v : [v]);
const mapV = (v, f) => (isSeries(v) ? v.map(f) : f(v));

const BINOPS = {
  "+": (x, y) => x + y, "-": (x, y) => x - y, "*": (x, y) => x * y, "/": (x, y) => x / y,
  "^": (x, y) => Math.pow(x, y),
  "<": (x, y) => (x < y ? 1 : 0), ">": (x, y) => (x > y ? 1 : 0), "<=": (x, y) => (x <= y ? 1 : 0),
  ">=": (x, y) => (x >= y ? 1 : 0), "==": (x, y) => (x === y ? 1 : 0), "!=": (x, y) => (x !== y ? 1 : 0),
};

export class Expression {
  constructor(source) {
    this.source = source;
    const p = new Parser(tokenize(source));
    this.root = p.comparison();
    if (p.peek.t !== "end") fail(`Malformed formula: ${source}`);
  }
  evaluate(scope, tax, degrees = false) { return new Evaluator(scope, tax, degrees).eval(this.root); }
  number(scope, tax, degrees = false) { return num(this.evaluate(scope, tax, degrees), "Result"); }
}

class Evaluator {
  constructor(scope, tax, degrees) { this.scope = scope; this.tax = tax; this.angle = degrees ? Math.PI / 180 : 1; }
  eval(n) {
    switch (n.k) {
      case "num": return n.v;
      case "var": {
        if (!Object.prototype.hasOwnProperty.call(this.scope, n.name)) fail(`Unknown value “${n.name}”.`);
        return this.scope[n.name];
      }
      case "neg": return mapV(this.eval(n.a), (x) => -x);
      case "bin": return this.binary(n.op, this.eval(n.a), this.eval(n.b));
      case "call": return this.call(n.name, n.args);
    }
  }
  binary(op, a, b) {
    const f = BINOPS[op];
    if (!f) fail(`Unknown operator ${op}.`);
    if (!isSeries(a) && !isSeries(b)) return f(a, b);
    if (isSeries(a) && !isSeries(b)) return a.map((x) => f(x, b));
    if (!isSeries(a) && isSeries(b)) return b.map((y) => f(a, y));
    if (a.length !== b.length) fail("Lists must be the same length.");
    return a.map((x, i) => f(x, b[i]));
  }
  call(name, argNodes) {
    if (name === "if") {
      if (argNodes.length !== 3) fail("if() takes three arguments.");
      return num(this.eval(argNodes[0]), "if") !== 0 ? this.eval(argNodes[1]) : this.eval(argNodes[2]);
    }
    const args = argNodes.map((a) => this.eval(a));
    const need = (k) => { if (args.length !== k) fail(`${name}() takes ${k} argument${k === 1 ? "" : "s"}.`); };
    const n = (i) => num(args[i], name);
    const s = (i) => list(args[i]);
    const tax = this.tax, angle = this.angle;
    const m1 = (f) => { need(1); return mapV(args[0], f); };
    switch (name) {
      case "fv": need(4); return Finance.fv(n(0), n(1), n(2), n(3));
      case "pv": need(3); return Finance.pv(n(0), n(1), n(2));
      case "pmt": need(3); return Finance.pmt(n(0), n(1), n(2));
      case "nper": need(4); return Finance.nper(n(0), n(1), n(2), n(3));
      case "rate": need(3); return Finance.rate(n(0), n(1), n(2));
      case "npv": need(2); return Finance.npv(n(0), s(1));
      case "irr": need(1); return Finance.irr(s(0));
      case "bondprice": need(5); return Finance.bondPrice(n(0), n(1), n(2), n(3), n(4));
      case "bondytm": need(5); return Finance.bondYTM(n(0), n(1), n(2), n(3), n(4));
      case "macdur": need(5); return Finance.macaulayDuration(n(0), n(1), n(2), n(3), n(4));
      case "bondconvexity": need(5); return Finance.convexity(n(0), n(1), n(2), n(3), n(4));
      case "nan": need(0); return NaN;
      case "pi": need(0); return Math.PI;
      case "median": need(1); return Stats.median(s(0));
      case "var": need(1); return Stats.variance(s(0));
      case "sd": need(1); return Stats.sd(s(0));
      case "cov": need(2); return Stats.covariance(s(0), s(1));
      case "corr": need(2); return Stats.correlation(s(0), s(1));
      case "dw": need(1); return Stats.durbinWatson(s(0));
      case "topsum": need(2); return Stats.topSum(s(0), n(1));
      case "normcdf": return m1(Stats.normCDF);
      case "norminv": need(1); return Stats.normInv(n(0));
      case "tcdf": need(2); return Stats.tCDF(n(0), n(1));
      case "tinv": need(2); return Stats.tInv(n(0), n(1));
      case "fcdf": need(3); return Stats.fCDF(n(0), n(1), n(2));
      case "binompmf": need(3); return Stats.binomPMF(n(0), n(1), n(2));
      case "binomcdf": need(3); return Stats.binomCDF(n(0), n(1), n(2));
      case "incometax": need(2); return tax.incomeTax(n(0), n(1));
      case "margrate": need(2); return tax.marginalRate(n(0), n(1));
      case "bracketroom": need(2); return tax.bracketRoom(n(0), n(1));
      case "stddeduction": need(1); return tax.standardDeductionFor(n(0));
      case "ltcgtax": need(3); return tax.ltcgTax(n(0), n(1), n(2));
      case "niitthreshold": need(1); return tax.niitThresholdFor(n(0));
      case "niitrate": need(0); return tax.niitRate;
      case "rmdfactor": need(1); return tax.rmdFactor(n(0));
      case "limit401k": need(1); return tax.limit401k(n(0));
      case "limitira": need(1); return tax.limitIRA(n(0));
      case "giftexclusion": need(0); return tax.giftAnnualExclusion;
      case "estateexemption": need(0); return tax.estateExemption;
      case "estaterate": need(0); return tax.estateTopRate;
      case "min": case "max": {
        if (!args.length) fail(`${name}() needs arguments.`);
        // Swift's Sequence.min()/max(): keep the running value unless the next one compares
        // strictly smaller/larger, so NaN never replaces a number (Math.min/max would return NaN).
        const all = args.flatMap(list);
        let best = all[0];
        for (const x of all.slice(1)) if (name === "min" ? x < best : best < x) best = x;
        return best;
      }
      case "abs": return m1(Math.abs);
      case "sin": return m1((x) => Math.sin(x * angle));
      case "cos": return m1((x) => Math.cos(x * angle));
      case "tan": return m1((x) => Math.tan(x * angle));
      case "asin": return m1((x) => Math.asin(x) / angle);
      case "acos": return m1((x) => Math.acos(x) / angle);
      case "atan": return m1((x) => Math.atan(x) / angle);
      case "sinh": return m1(Math.sinh);
      case "cosh": return m1(Math.cosh);
      case "tanh": return m1(Math.tanh);
      case "log":
        if (args.length === 2) return Math.log(n(0)) / Math.log(n(1));
        return m1(Math.log10);
      case "log2": return m1(Math.log2);
      case "cbrt": return m1(Math.cbrt);
      case "e": need(0); return Math.E;
      case "mod": {
        need(2);
        const a = n(0), b = n(1);
        if (b === 0) fail("mod() by zero.");
        return a - b * Math.floor(a / b);
      }
      case "round":
        if (args.length === 2) { const f = Math.pow(10, roundHalfAway(n(1))); return roundHalfAway(n(0) * f) / f; }
        return m1(roundHalfAway);
      case "fact": need(1); return Scientific.factorial(n(0));
      case "ncr": need(2); return Scientific.combinations(n(0), n(1));
      case "npr": need(2); return Scientific.permutations(n(0), n(1));
      case "sqrt": return m1(Math.sqrt);
      case "ln": return m1(Math.log);
      case "exp": return m1(Math.exp);
      case "floor": return m1(Math.floor);
      case "ceil": return m1(Math.ceil);
      case "sum": need(1); return s(0).reduce((a, b) => a + b, 0);
      case "count": need(1); return s(0).length;
      case "avg": {
        need(1);
        const l = s(0);
        if (!l.length) fail("avg() of an empty list.");
        return l.reduce((a, b) => a + b, 0) / l.length;
      }
      case "sumproduct": {
        need(2);
        const a = s(0), b = s(1);
        if (a.length !== b.length) fail("Lists must be the same length.");
        return a.reduce((t, x, i) => t + x * b[i], 0);
      }
      default: fail(`Unknown function ${name}().`);
    }
  }
}

// ---------------------------------------------------------------------------
// Projections

class SplitMix64 {
  constructor(seed) { this.state = BigInt.asUintN(64, BigInt(seed)); }
  next() {
    this.state = BigInt.asUintN(64, this.state + 0x9E3779B97F4A7C15n);
    let z = this.state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94D049BB133111EBn);
    return z ^ (z >> 31n);
  }
  uniform() { return Number(this.next() >> 11n) * (1 / 9007199254740992); }
  normal() {
    const u1 = Math.max(this.uniform(), 1e-300), u2 = this.uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

function percentile(sorted, p) {
  const idx = p * (sorted.length - 1), lo = Math.floor(idx), hi = Math.min(lo + 1, sorted.length - 1), frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}
const asc = (a) => a.sort((x, y) => x - y);
const seedOf = (s) => Math.trunc(Math.max(0, s));

export const Projections = {
  run(kind, v) {
    switch (kind) {
      case "retirement": return Projections.retirement(v);
      case "montecarlo": return Projections.monteCarlo(v);
      case "retirementmc": return Projections.retirementMonteCarlo(v);
      case "growth": return Projections.growth(v);
      default: fail(`Unknown projection ${kind}.`);
    }
  },
  retirement(v) {
    const a0 = trunc(v.age), ar = trunc(v.retire), ae = trunc(v.plan);
    const { c, cg, rpre, rpost, spend, infl, other, oage } = v;
    let bal = v.bal;
    const rows = [];
    let retireBal = ar <= a0 ? bal : null, depletion = -1, totalW = 0, firstW = 0;
    for (let age = a0; age < ae; age++) {
      const t = age - a0;
      if (age === ar) retireBal = bal;
      const start = bal;
      const contrib = age < ar ? c * Math.pow(1 + cg, t) : 0;
      const need = age >= ar ? spend * Math.pow(1 + infl, t) : 0;
      const oth = (age >= ar && age >= oage) ? other * Math.pow(1 + infl, t) : 0;
      let w = Math.max(0, need - oth);
      if (w > start + contrib) { w = start + contrib; if (depletion < 0) depletion = age; }
      if (age === ar) firstW = w;
      const r = age < ar ? rpre : rpost;
      const base = start + contrib - w, end = base * (1 + r);
      totalW += w;
      rows.push([age, start, contrib, w, end - base, end]);
      bal = end;
    }
    return {
      scalars: { p_retire_balance: retireBal ?? bal, p_end_balance: bal, p_depletion_age: depletion, p_first_withdrawal: firstW, p_total_withdrawn: totalW },
      rows,
    };
  },
  monteCarlo(v) {
    const sims = trunc(v.sims), years = trunc(v.years), { mean, sd, infl } = v;
    const rng = new SplitMix64(seedOf(v.seed));
    const paths = new Array(sims);
    let ok = 0;
    for (let s = 0; s < sims; s++) {
      let bal = v.bal, w = v.w, failed = false;
      const path = new Float64Array(years);
      for (let y = 0; y < years; y++) {
        const z = rng.normal();
        if (!failed) {
          if (bal < w) { bal = 0; failed = true; }
          else { bal -= w; bal = Math.max(0, bal * (1 + mean + sd * z)); w *= 1 + infl; }
        }
        path[y] = bal;
      }
      if (!failed) ok++;
      paths[s] = path;
    }
    const ending = asc(paths.map((p) => p[years - 1]));
    const rows = [];
    for (let y = 0; y < years; y++) {
      const col = asc(paths.map((p) => p[y]));
      rows.push([y + 1, percentile(col, 0.10), percentile(col, 0.50), percentile(col, 0.90)]);
    }
    return {
      scalars: { p_success: ok / sims, p_end_p10: percentile(ending, 0.10), p_end_p50: percentile(ending, 0.50), p_end_p90: percentile(ending, 0.90) },
      rows,
    };
  },
  retirementMonteCarlo(v) {
    const a0 = trunc(v.age), ar = trunc(v.retire), ae = trunc(v.plan), sims = trunc(v.sims);
    const { c, cg, rpre, rpost, sd, spend, infl, other, oage } = v;
    const rng = new SplitMix64(seedOf(v.seed));
    const years = Math.max(0, ae - a0);
    const paths = new Array(sims), retireBals = [];
    let ok = 0;
    for (let s = 0; s < sims; s++) {
      let bal = v.bal, failed = false;
      const path = new Float64Array(years);
      let retireBal = ar <= a0 ? bal : null;
      for (let age = a0; age < ae; age++) {
        const t = age - a0, z = rng.normal();
        if (age === ar) retireBal = bal;
        if (!failed) {
          const contrib = age < ar ? c * Math.pow(1 + cg, t) : 0;
          const need = age >= ar ? spend * Math.pow(1 + infl, t) : 0;
          const oth = (age >= ar && age >= oage) ? other * Math.pow(1 + infl, t) : 0;
          const w = Math.max(0, need - oth);
          if (w > bal + contrib) { bal = 0; failed = true; }
          else { const m = age < ar ? rpre : rpost; bal = Math.max(0, (bal + contrib - w) * (1 + m + sd * z)); }
        }
        path[t] = bal;
      }
      if (!failed) ok++;
      paths[s] = path;
      retireBals.push(retireBal ?? bal);
    }
    if (years <= 0) {
      return { scalars: { p_success: 1, p_retire_p50: v.bal, p_end_p10: v.bal, p_end_p50: v.bal, p_end_p90: v.bal }, rows: [] };
    }
    const ending = asc(paths.map((p) => p[years - 1]));
    const rows = [];
    for (let y = 0; y < years; y++) {
      const col = asc(paths.map((p) => p[y]));
      rows.push([a0 + y + 1, percentile(col, 0.10), percentile(col, 0.50), percentile(col, 0.90)]);
    }
    return {
      scalars: {
        p_success: ok / sims, p_retire_p50: percentile(asc(retireBals), 0.50),
        p_end_p10: percentile(ending, 0.10), p_end_p50: percentile(ending, 0.50), p_end_p90: percentile(ending, 0.90),
      },
      rows,
    };
  },
  growth(v) {
    const { p, m, r, infl } = v, y = trunc(v.y), i = r / 12;
    let bal = p;
    const rows = [];
    for (let year = 1; year <= y; year++) {
      for (let k = 0; k < 12; k++) bal = bal * (1 + i) + m;
      const contributed = p + m * 12 * year;
      rows.push([year, contributed, bal - contributed, bal, bal / Math.pow(1 + infl, year)]);
    }
    const contributed = p + m * 12 * y;
    return { scalars: { p_balance: bal, p_contributed: contributed, p_growth: bal - contributed, p_real: bal / Math.pow(1 + infl, y) }, rows };
  },
};

// ---------------------------------------------------------------------------
// Formatting

const nf = new Map();
function numberFormat(maxDecimals, grouping) {
  const k = `${maxDecimals}|${grouping}`;
  if (!nf.has(k)) nf.set(k, new Intl.NumberFormat("en-US", { maximumFractionDigits: maxDecimals, minimumFractionDigits: 0, useGrouping: grouping }));
  return nf.get(k);
}

export const Format = {
  value(v, format) {
    if (v === null || v === undefined) return "—";
    if (Number.isNaN(v)) return "n/a";
    switch (format) {
      case "currency": return Format.currency(v);
      case "percent": return Format.percent(v);
      case "years": return Format.plain(v, 2) + (Math.abs(v - 1) < 1e-9 ? " year" : " years");
      case "age": return v < 0 ? "Never" : Format.plain(v, 1);
      case "multiple": return Format.plain(v, 2) + "×";
      default: return Format.plain(v, 4);
    }
  },
  currency(v) {
    const digits = (Math.abs(v) >= 1000 || v === 0) ? 0 : 2;
    const s = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    return s.replace("-", "−");
  },
  percent(v) { return Format.plain(v * 100, 2) + "%"; },
  plain(v, maxDecimals = 4) {
    if (!Number.isFinite(v)) return Number.isNaN(v) ? "n/a" : (v > 0 ? "∞" : "−∞");
    const s = numberFormat(maxDecimals, maxDecimals <= 4).format(v);
    return maxDecimals <= 4 ? s.replace("-", "−") : s;
  },
  compact(v) {
    const a = Math.abs(v), sign = v < 0 ? "−" : "";
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
    return `${sign}$${a.toFixed(0)}`;
  },
};

// ---------------------------------------------------------------------------
// Engine

export const fieldKind = {
  isSeries: (f) => f.unit === "series",
  isChoice: (f) => f.unit === "choice",
  isPercent: (f) => f.unit === "%",
  blankValue: (f) => f.default ?? (f.unit === "choice" ? f.example : ""),
};

const TAX_FUNCS = ["incometax(", "margrate(", "bracketroom(", "stddeduction(", "ltcgtax(", "niitthreshold(",
  "niitrate(", "rmdfactor(", "limit401k(", "limitira(", "giftexclusion(", "estateexemption(", "estaterate("];

export function usesTaxTable(calc) {
  const text = [...calc.outputs.map((o) => o.expression), ...calc.rules.map((r) => r.left), ...calc.rules.map((r) => r.right)].join(" ");
  return TAX_FUNCS.some((n) => text.includes(n));
}
export const exampleInputs = (calc) => Object.fromEntries(calc.fields.map((f) => [f.id, f.example]));
export const blankInputs = (calc) => Object.fromEntries(calc.fields.map((f) => [f.id, fieldKind.blankValue(f)]));

export class Engine {
  constructor(calculators, taxData, year) {
    this.calculators = calculators;
    this.taxData = taxData;
    this.tax = taxData.table(year ?? taxData.defaultYear()) || taxData.table(taxData.defaultYear());
    this.compiled = new Map();
  }
  selectTaxYear(year) {
    const t = this.taxData.table(year);
    if (!t) return false;
    this.tax = t;
    return true;
  }
  calculator(id) { return this.calculators.find((c) => c.id === id) || null; }
  expression(src) {
    let e = this.compiled.get(src);
    if (!e) { e = new Expression(src); this.compiled.set(src, e); }
    return e;
  }

  static parse(raw, field) {
    const text = String(raw ?? "").trim();
    if (!text) fail("Required.");
    if (fieldKind.isSeries(field)) {
      const parts = text.split(/[;\n\t]/).map((p) => p.trim()).filter(Boolean);
      if (!parts.length) fail("Enter at least one value.");
      return parts.map((p) => Engine.parseNumber(p, false));
    }
    const v = Engine.parseNumber(text, fieldKind.isPercent(field));
    if (field.integer === true && roundHalfAway(v) !== v) fail("Use a whole number.");
    const describe = (x) => (fieldKind.isPercent(field) ? Format.percent(x) : Format.plain(x));
    if (field.min !== undefined && field.min !== null && v < field.min) fail(`Must be at least ${describe(field.min)}.`);
    if (field.max !== undefined && field.max !== null && v > field.max) fail(`Must be at most ${describe(field.max)}.`);
    if (fieldKind.isChoice(field) && field.options && !field.options.some((o) => o.value === v)) fail("Pick one of the options.");
    return v;
  }

  static parseNumber(raw, percent) {
    let s = String(raw).replaceAll("−", "-").replaceAll(",", "").replaceAll("$", "").replaceAll("_", "").replaceAll(" ", "");
    let negative = false;
    if (s.startsWith("(") && s.endsWith(")")) { negative = true; s = s.slice(1, -1); }
    let scale = 1, hadPct = false;
    if (s.endsWith("%")) { hadPct = true; s = s.slice(0, -1); }
    const last = s.slice(-1).toLowerCase();
    if (last === "k") { scale = 1e3; s = s.slice(0, -1); }
    else if (last === "m") { scale = 1e6; s = s.slice(0, -1); }
    else if (last === "b") { scale = 1e9; s = s.slice(0, -1); }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) fail("Not a number.");
    const d = Number(s);
    if (!Number.isFinite(d)) fail("Not a number.");
    let v = d * scale * (negative ? -1 : 1);
    if (percent || hadPct) v /= 100;
    return v;
  }

  evaluate(calc, inputs) {
    const result = { fieldErrors: {}, ruleErrors: [], outputs: [], table: null, values: {} };
    const scope = {};
    for (const f of calc.fields) {
      try {
        const v = Engine.parse(inputs[f.id] ?? "", f);
        scope[f.id] = v;
        if (!isSeries(v)) result.values[f.id] = v;
      } catch (e) {
        result.fieldErrors[f.id] = e.message;
      }
    }
    if (Object.keys(result.fieldErrors).length) return result;

    for (const rule of calc.rules) {
      try {
        const l = this.expression(rule.left).number(scope, this.tax);
        const r = this.expression(rule.right).number(scope, this.tax);
        const ok = { "<": l < r, "<=": l <= r, ">": l > r, ">=": l >= r, "==": l === r, "!=": l !== r }[rule.relation] ?? false;
        if (!ok) result.ruleErrors.push(rule.message);
      } catch (e) {
        result.ruleErrors.push(e.message);
      }
    }
    if (result.ruleErrors.length) return result;

    if (calc.projection) {
      try {
        const p = Projections.run(calc.projection, result.values);
        Object.assign(scope, p.scalars);
        if (calc.table) result.table = { spec: calc.table, rows: p.rows };
      } catch (e) {
        result.ruleErrors.push(e.message);
        return result;
      }
    }

    for (const o of calc.outputs) {
      try {
        const v = this.expression(o.expression).number(scope, this.tax);
        if (v === Infinity || v === -Infinity) fail("Can't be computed with these inputs (the result is infinite, e.g. a division by zero).");
        if (Number.isNaN(v) && !(o.expression.includes("bracketroom") || o.expression.includes("nan()"))) {
          fail("No valid answer for these inputs (for example, a root or log of a negative number).");
        }
        result.outputs.push({ id: o.id, label: o.label, format: o.format, value: v, error: null });
      } catch (e) {
        result.outputs.push({ id: o.id, label: o.label, format: o.format, value: null, error: e.message });
      }
    }
    return result;
  }

  static isComplete(ev) {
    return !Object.keys(ev.fieldErrors).length && !ev.ruleErrors.length && ev.outputs.length > 0;
  }

  // Excel helpers
  static column(n) {
    let index = n + 1, s = "";
    while (index > 0) { const r = (index - 1) % 26; s = String.fromCharCode(65 + r) + s; index = Math.floor((index - 1) / 26); }
    return s;
  }
  static resolve(template, refs) {
    let out = template;
    for (const [k, v] of Object.entries(refs)) out = out.replaceAll(`{${k}}`, v);
    return out;
  }
  excelGrid(calc, inputs) {
    const lines = [`${calc.name}\tWealth Desk`], refs = {};
    calc.fields.forEach((f, i) => {
      const row = i + 2, raw = inputs[f.id] ?? "";
      let parsed = null;
      try { parsed = Engine.parse(raw, f); } catch { /* keep raw */ }
      if (fieldKind.isSeries(f) && isSeries(parsed)) {
        const cells = parsed.map((x) => Format.plain(x, 10));
        lines.push([f.label, ...cells].join("\t"));
        refs[f.id] = `B${row}:${Engine.column(cells.length)}${row}`;
      } else {
        let cell = raw.trim();
        if (parsed !== null && !isSeries(parsed)) cell = fieldKind.isPercent(f) ? Format.plain(parsed * 100, 10) + "%" : Format.plain(parsed, 10);
        lines.push(`${f.label}\t${cell}`);
        refs[f.id] = `B${row}`;
      }
    });
    lines.push("");
    const ev = this.evaluate(calc, inputs);
    for (const o of calc.outputs) {
      if (o.excel) lines.push(`${o.label}\t${Engine.resolve(o.excel, refs)}`);
      else {
        const v = ev.outputs.find((x) => x.id === o.id)?.value;
        const text = v === null || v === undefined ? "" : Number.isNaN(v) ? "n/a" : Format.plain(v, 10);
        lines.push(`${o.label}\t${text}\tvalue from Wealth Desk (no Excel formula)`);
      }
    }
    return lines.join("\n");
  }
  excelFormula(calc, output) {
    if (!output.excel) return null;
    const refs = {};
    calc.fields.forEach((f, i) => {
      const row = i + 2;
      refs[f.id] = fieldKind.isSeries(f) ? `B${row}:${Engine.column(f.example.split(";").length)}${row}` : `B${row}`;
    });
    return Engine.resolve(output.excel, refs);
  }
}

export function categories(calcs) {
  const seen = [];
  for (const c of calcs) if (!seen.includes(c.category)) seen.push(c.category);
  return seen;
}

export function search(query, calcs) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}%]+/u).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const c of calcs) {
    const text = [c.name, c.category, c.summary, c.aliases, c.acronym, c.math].join(" ").toLowerCase();
    if (!words.every((w) => text.includes(w))) continue;
    const name = c.name.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (c.acronym.toLowerCase() === w) score += 50;
      if (name.startsWith(w)) score += 20;
      if (name.includes(w)) score += 10;
      if (c.aliases.toLowerCase().includes(w)) score += 3;
    }
    if (c.common) score += 2;
    scored.push([score, c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}
