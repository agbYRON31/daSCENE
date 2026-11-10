import Foundation

/// Time-value-of-money functions. Sign convention: all money is positive;
/// results are positive amounts (unlike Excel, which signs outflows negative).
public enum Finance {
    /// Future value of `pv` plus end-of-period payments `pmt`.
    public static func fv(_ r: Double, _ n: Double, _ pmt: Double, _ pv: Double) -> Double {
        if r == 0 { return pv + pmt * n }
        let g = pow(1 + r, n)
        return pv * g + pmt * (g - 1) / r
    }

    /// Present value of `n` end-of-period payments.
    public static func pv(_ r: Double, _ n: Double, _ pmt: Double) -> Double {
        if r == 0 { return pmt * n }
        return pmt * (1 - pow(1 + r, -n)) / r
    }

    /// Level end-of-period payment that amortizes `pv` over `n` periods.
    public static func pmt(_ r: Double, _ n: Double, _ pv: Double) -> Double {
        if r == 0 { return pv / n }
        return pv * r / (1 - pow(1 + r, -n))
    }

    /// Periods for `pv` with payment `pmt` (negative = withdrawal) to reach `fv`.
    public static func nper(_ r: Double, _ pmt: Double, _ pv: Double, _ fv: Double) -> Double {
        if r == 0 { return (fv - pv) / pmt }
        return log((fv * r + pmt) / (pv * r + pmt)) / log(1 + r)
    }

    /// Periodic rate at which the PV of `n` payments of `pmt` equals `pv`.
    public static func rate(_ n: Double, _ pmt: Double, _ pv: Double) -> Double {
        var lo = -0.99, hi = 10.0
        for _ in 0..<400 {
            let mid = (lo + hi) / 2
            let value = mid != 0 ? Finance.pv(mid, n, pmt) : pmt * n
            if value > pv { lo = mid } else { hi = mid }
        }
        return (lo + hi) / 2
    }

    /// NPV with the first cash flow at time 0 (Excel: CF0 + NPV(r, rest)).
    public static func npv(_ r: Double, _ cf: [Double]) -> Double {
        var total = 0.0
        for (t, c) in cf.enumerated() { total += c / pow(1 + r, Double(t)) }
        return total
    }

    /// Number of sign changes, ignoring zeros.
    public static func signChanges(_ cf: [Double]) -> Int {
        var changes = 0
        var last: Bool? = nil
        for c in cf where c != 0 {
            let pos = c > 0
            if let l = last, l != pos { changes += 1 }
            last = pos
        }
        return changes
    }

    /// IRR by bisection. Requires exactly one sign change so the answer is unique.
    public static func irr(_ cf: [Double]) throws -> Double {
        guard cf.count >= 2 else { throw EvalError.message("IRR needs at least two cash flows.") }
        let changes = signChanges(cf)
        guard changes == 1 else {
            throw EvalError.message(changes == 0
                ? "IRR needs both money in (negative) and money out (positive)."
                : "These cash flows change sign more than once, so IRR has no single answer.")
        }
        var lo = -0.9999, hi = 10.0
        var flo = npv(lo, cf)
        for _ in 0..<300 {
            let mid = (lo + hi) / 2
            let fm = npv(mid, cf)
            if (fm > 0) == (flo > 0) { lo = mid; flo = fm } else { hi = mid }
        }
        return (lo + hi) / 2
    }
}
