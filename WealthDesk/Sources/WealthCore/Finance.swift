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

    // MARK: Bonds (priced on a coupon date, no accrued interest)

    static func periods(_ years: Double, _ freq: Double) -> Int {
        Int((years * freq + 0.5).rounded(.down))
    }

    public static func bondPrice(_ face: Double, _ cpn: Double, _ ytm: Double, _ years: Double, _ freq: Double) -> Double {
        let n = Double(periods(years, freq))
        let i = ytm / freq
        let c = face * cpn / freq
        if i == 0 { return c * n + face }
        return c * (1 - pow(1 + i, -n)) / i + face * pow(1 + i, -n)
    }

    public static func bondYTM(_ price: Double, _ face: Double, _ cpn: Double, _ years: Double, _ freq: Double) -> Double {
        var lo = -0.5, hi = 1.0
        for _ in 0..<300 {
            let mid = (lo + hi) / 2
            if bondPrice(face, cpn, mid, years, freq) > price { lo = mid } else { hi = mid }
        }
        return (lo + hi) / 2
    }

    public static func macaulayDuration(_ face: Double, _ cpn: Double, _ ytm: Double, _ years: Double, _ freq: Double) -> Double {
        let n = periods(years, freq)
        guard n >= 1 else { return .nan }
        let i = ytm / freq
        let c = face * cpn / freq
        var total = 0.0
        for k in 1...n {
            let cf = c + (k == n ? face : 0.0)
            total += (Double(k) / freq) * cf / pow(1 + i, Double(k))
        }
        return total / bondPrice(face, cpn, ytm, years, freq)
    }

    public static func convexity(_ face: Double, _ cpn: Double, _ ytm: Double, _ years: Double, _ freq: Double) -> Double {
        let n = periods(years, freq)
        guard n >= 1 else { return .nan }
        let i = ytm / freq
        let c = face * cpn / freq
        var total = 0.0
        for k in 1...n {
            let cf = c + (k == n ? face : 0.0)
            total += cf * Double(k) * Double(k + 1) / pow(1 + i, Double(k + 2))
        }
        return total / (bondPrice(face, cpn, ytm, years, freq) * freq * freq)
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
