import Foundation

public struct ProjectionResult {
    public var scalars: [String: Double]
    public var rows: [[Double]]
}

/// Multi-year models that produce a table plus summary values. Each mirrors the
/// reference implementation in tools/build_catalog.py operation for operation.
public enum Projections {
    public static func run(_ kind: String, _ v: [String: Double]) throws -> ProjectionResult {
        switch kind {
        case "retirement": return retirement(v)
        case "montecarlo": return monteCarlo(v)
        default: throw EvalError.message("Unknown projection \(kind).")
        }
    }

    static func retirement(_ v: [String: Double]) -> ProjectionResult {
        let a0 = Int(v["age"]!), ar = Int(v["retire"]!), ae = Int(v["plan"]!)
        let c = v["c"]!, cg = v["cg"]!, rpre = v["rpre"]!, rpost = v["rpost"]!
        let spend = v["spend"]!, infl = v["infl"]!, other = v["other"]!, oage = v["oage"]!
        var bal = v["bal"]!
        var rows: [[Double]] = []
        var retireBal: Double? = ar <= a0 ? bal : nil
        var depletion = -1.0
        var totalW = 0.0
        var firstW = 0.0
        if a0 < ae {
            for age in a0..<ae {
                let t = Double(age - a0)
                if age == ar { retireBal = bal }
                let start = bal
                let contrib = age < ar ? c * pow(1 + cg, t) : 0.0
                let need = age >= ar ? spend * pow(1 + infl, t) : 0.0
                let oth = (age >= ar && Double(age) >= oage) ? other * pow(1 + infl, t) : 0.0
                var w = max(0.0, need - oth)
                if w > start + contrib {
                    w = start + contrib
                    if depletion < 0 { depletion = Double(age) }
                }
                if age == ar { firstW = w }
                let r = age < ar ? rpre : rpost
                let base = start + contrib - w
                let end = base * (1 + r)
                totalW += w
                rows.append([Double(age), start, contrib, w, end - base, end])
                bal = end
            }
        }
        return ProjectionResult(scalars: [
            "p_retire_balance": retireBal ?? bal,
            "p_end_balance": bal,
            "p_depletion_age": depletion,
            "p_first_withdrawal": firstW,
            "p_total_withdrawn": totalW,
        ], rows: rows)
    }

    struct SplitMix64 {
        var state: UInt64
        mutating func next() -> UInt64 {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
        mutating func uniform() -> Double { Double(next() >> 11) * (1.0 / 9007199254740992.0) }
        mutating func normal() -> Double {
            let u1 = max(uniform(), 1e-300)
            let u2 = uniform()
            return (-2.0 * log(u1)).squareRoot() * cos(2.0 * Double.pi * u2)
        }
    }

    /// Linear-interpolated percentile of an ascending array.
    static func percentile(_ sorted: [Double], _ p: Double) -> Double {
        let idx = p * Double(sorted.count - 1)
        let lo = Int(idx.rounded(.down))
        let hi = min(lo + 1, sorted.count - 1)
        let frac = idx - Double(lo)
        return sorted[lo] + (sorted[hi] - sorted[lo]) * frac
    }

    static func monteCarlo(_ v: [String: Double]) -> ProjectionResult {
        let sims = Int(v["sims"]!), years = Int(v["years"]!)
        let mean = v["mean"]!, sd = v["sd"]!, infl = v["infl"]!
        var rng = SplitMix64(state: UInt64(max(0, v["seed"]!)))
        var paths = [[Double]](repeating: [], count: sims)
        var ok = 0
        for s in 0..<sims {
            var bal = v["bal"]!, w = v["w"]!
            var failed = false
            var path = [Double]()
            path.reserveCapacity(years)
            for _ in 0..<years {
                let z = rng.normal()
                if !failed {
                    if bal < w {
                        bal = 0
                        failed = true
                    } else {
                        bal -= w
                        bal = max(0.0, bal * (1 + mean + sd * z))
                        w *= 1 + infl
                    }
                }
                path.append(bal)
            }
            if !failed { ok += 1 }
            paths[s] = path
        }
        let ending = paths.map { $0[years - 1] }.sorted()
        var rows: [[Double]] = []
        for y in 0..<years {
            let col = paths.map { $0[y] }.sorted()
            rows.append([Double(y + 1), percentile(col, 0.10), percentile(col, 0.50), percentile(col, 0.90)])
        }
        return ProjectionResult(scalars: [
            "p_success": Double(ok) / Double(sims),
            "p_end_p10": percentile(ending, 0.10),
            "p_end_p50": percentile(ending, 0.50),
            "p_end_p90": percentile(ending, 0.90),
        ], rows: rows)
    }
}
