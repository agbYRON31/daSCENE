import Foundation

/// Statistics and distribution functions. Each mirrors the reference
/// implementation in tools/build_catalog.py.
public enum Stats {
    static func requireCount(_ s: [Double], _ n: Int, _ name: String) throws {
        guard s.count >= n else { throw EvalError.message("\(name) needs at least \(n) values.") }
    }

    public static func mean(_ s: [Double]) -> Double { s.reduce(0, +) / Double(s.count) }

    public static func median(_ s: [Double]) throws -> Double {
        try requireCount(s, 1, "Median")
        let v = s.sorted()
        let n = v.count
        return n % 2 == 1 ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2
    }

    public static func variance(_ s: [Double]) throws -> Double {
        try requireCount(s, 2, "Variance")
        let m = mean(s)
        var total = 0.0
        for x in s { total += (x - m) * (x - m) }
        return total / Double(s.count - 1)
    }

    public static func sd(_ s: [Double]) throws -> Double { try variance(s).squareRoot() }

    public static func covariance(_ a: [Double], _ b: [Double]) throws -> Double {
        guard a.count == b.count else { throw EvalError.message("Lists must be the same length.") }
        try requireCount(a, 2, "Covariance")
        let ma = mean(a), mb = mean(b)
        var total = 0.0
        for (x, y) in zip(a, b) { total += (x - ma) * (y - mb) }
        return total / Double(a.count - 1)
    }

    public static func correlation(_ a: [Double], _ b: [Double]) throws -> Double {
        try covariance(a, b) / (try sd(a) * sd(b))
    }

    public static func durbinWatson(_ e: [Double]) throws -> Double {
        try requireCount(e, 2, "Durbin–Watson")
        var num = 0.0
        for i in 1..<e.count { num += (e[i] - e[i - 1]) * (e[i] - e[i - 1]) }
        var den = 0.0
        for x in e { den += x * x }
        return num / den
    }

    public static func topSum(_ s: [Double], _ k: Double) -> Double {
        s.sorted(by: >).prefix(max(0, Int(k))).reduce(0, +)
    }

    // MARK: Distributions

    public static func normCDF(_ z: Double) -> Double { 0.5 * erfc(-z / 2.0.squareRoot()) }

    public static func normInv(_ p: Double) throws -> Double {
        guard p > 0 && p < 1 else { throw EvalError.message("Probability must be between 0 and 1.") }
        var lo = -40.0, hi = 40.0
        for _ in 0..<200 {
            let mid = (lo + hi) / 2
            if normCDF(mid) < p { lo = mid } else { hi = mid }
        }
        return (lo + hi) / 2
    }

    static func betacf(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let fpmin = 1e-300
        let qab = a + b, qap = a + 1.0, qam = a - 1.0
        var c = 1.0
        var d = 1.0 - qab * x / qap
        if abs(d) < fpmin { d = fpmin }
        d = 1.0 / d
        var h = d
        for mi in 1...300 {
            let m = Double(mi)
            let m2 = 2.0 * m
            var aa = m * (b - m) * x / ((qam + m2) * (a + m2))
            d = 1.0 + aa * d
            if abs(d) < fpmin { d = fpmin }
            c = 1.0 + aa / c
            if abs(c) < fpmin { c = fpmin }
            d = 1.0 / d
            h *= d * c
            aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
            d = 1.0 + aa * d
            if abs(d) < fpmin { d = fpmin }
            c = 1.0 + aa / c
            if abs(c) < fpmin { c = fpmin }
            d = 1.0 / d
            let de = d * c
            h *= de
            if abs(de - 1.0) < 3e-16 { break }
        }
        return h
    }

    /// Regularized incomplete beta function I_x(a, b).
    static func betai(_ a: Double, _ b: Double, _ x: Double) -> Double {
        if x <= 0 { return 0 }
        if x >= 1 { return 1 }
        // Split into typed steps (same left-to-right order) so newer compilers type-check it quickly.
        let gammas: Double = lgamma(a + b) - lgamma(a) - lgamma(b)
        let logs: Double = gammas + a * log(x)
        let bt: Double = exp(logs + b * log(1.0 - x))
        if x < (a + 1.0) / (a + b + 2.0) { return bt * betacf(a, b, x) / a }
        return 1.0 - bt * betacf(b, a, 1.0 - x) / b
    }

    public static func tCDF(_ t: Double, _ df: Double) throws -> Double {
        guard df > 0 else { throw EvalError.message("Degrees of freedom must be positive.") }
        let x = df / (df + t * t)
        let p = 0.5 * betai(df / 2.0, 0.5, x)
        return t > 0 ? 1.0 - p : p
    }

    public static func tInv(_ p: Double, _ df: Double) throws -> Double {
        guard p > 0 && p < 1 else { throw EvalError.message("Probability must be between 0 and 1.") }
        var lo = -1000.0, hi = 1000.0
        for _ in 0..<200 {
            let mid = (lo + hi) / 2
            if try tCDF(mid, df) < p { lo = mid } else { hi = mid }
        }
        return (lo + hi) / 2
    }

    public static func fCDF(_ f: Double, _ d1: Double, _ d2: Double) throws -> Double {
        guard d1 > 0 && d2 > 0 else { throw EvalError.message("Degrees of freedom must be positive.") }
        if f <= 0 { return 0 }
        return betai(d1 / 2.0, d2 / 2.0, d1 * f / (d1 * f + d2))
    }

    public static func binomPMF(_ nD: Double, _ kD: Double, _ p: Double) -> Double {
        let n = Int(nD), k = Int(kD)
        if k < 0 || k > n { return 0 }
        if p == 0 { return k == 0 ? 1 : 0 }
        if p == 1 { return k == n ? 1 : 0 }
        // Typed steps in the same left-to-right order, so newer compilers type-check it quickly.
        let gammas: Double = lgamma(Double(n + 1)) - lgamma(Double(k + 1)) - lgamma(Double(n - k + 1))
        let withK: Double = gammas + Double(k) * log(p)
        return exp(withK + Double(n - k) * log(1 - p))
    }

    public static func binomCDF(_ n: Double, _ k: Double, _ p: Double) -> Double {
        var total = 0.0
        if Int(k) >= 0 {
            for i in 0...Int(k) { total += binomPMF(n, Double(i), p) }
        }
        return min(1.0, total)
    }
}
