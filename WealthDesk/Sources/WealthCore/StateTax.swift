import Foundation

/// State individual income tax tables, stored in each year of taxdata.json.
/// Mirrors the reference functions in tools/build_catalog.py step for step.
public struct StateTaxes: Codable {
    public let taxYear: Int
    public let verifiedOn: String
    public let sources: [Source]
    public let notes: [String]
    public let list: [StateTax]
}

public struct StateTax: Codable {
    public struct Separate: Codable { public let deduction: Double; public let brackets: [[Double]] }
    public struct Gains: Codable {
        public let exclude: Double?
        public let excludeFlat: Double?
        public let exemptAbove: Double?
        public let maxRate: Double?
        public let surtax: Double?
        public let agiOver: Double?
        public let niiSurtax: Double?
        public let niiOver: Double?
        public let none: Bool?
        public let rates: [Double]?
        public let threshold: [String: Double]?
        public let separate: Separate?
    }
    public let value: Int
    public let code: String
    public let name: String
    public let verified: String
    public let notes: [String]
    public let none: Bool?
    public let brackets: [String: [[Double]]]?
    public let deduction: [String: Double]?
    public let exemption: [String: Double]?
    public let credit: [String: Double]?
    public let deductionPhaseout: [String: [Double]]?
    public let phaseoutRound: Double?
    public let gains: Gains?
    /// New York: recapture of the lower brackets (IT-201 tax computation worksheets).
    public struct Recapture: Codable { public let agiStart: Double; public let phaseIn: Double; public let flatAgi: Double; public let first: [String: Int] }
    public let recapture: Recapture?
    /// Connecticut: exemption phase-out [start, width, step], add-backs [[start, width, step, cap]], credit share [[over, decimal]].
    public let exemptionPhaseout: [String: [Double]]?
    public let addBack: [String: [[Double]]]?
    public let creditRate: [String: [[Double]]]?

    /// Status 1 single, 2 married filing jointly, 3 head of household (single amounts unless the state publishes its own).
    func key<T>(_ status: Double, _ table: [String: T]) -> String {
        switch Int(status) {
        case 2: return "married"
        case 3 where table["hoh"] != nil: return "hoh"
        default: return "single"
        }
    }

    static func bracketTax(_ b: [[Double]], _ x: Double) -> Double {
        var tax = 0.0
        for i in b.indices {
            let floor = b[i][0], rate = b[i][1]
            let top = i + 1 < b.count ? b[i + 1][0] : Double.infinity
            if x > floor { tax += (Swift.min(x, top) - floor) * rate }
        }
        return tax
    }

    /// Steps of `width` (or part of one) that `n` is over `start`.
    static func steps(_ n: Double, _ start: Double, _ width: Double) -> Double {
        n > start ? ((n - start) / width - 1e-9).rounded(.up) : 0
    }

    static func roundHalfUp(_ x: Double, _ places: Int = 0) -> Double {
        let m = pow(10.0, Double(places))
        return (x * m + 0.5 + 1e-7).rounded(.down) / m
    }

    static func bracketIndex(_ b: [[Double]], _ x: Double) -> Int {
        var j = 0
        for i in b.indices where x > b[i][0] { j = i }
        return j
    }

    /// New York worksheet amounts for bracket j: recapture base and incremental benefit.
    static func recaptureParts(_ b: [[Double]], _ j: Int) -> (base: Double, increment: Double) {
        let bk = b[j][0]
        let base = roundHalfUp(bk * b[j - 1][1] - bracketTax(b, bk))
        let total = roundHalfUp(bk * b[j][1] - bracketTax(b, bk))
        return (base, total - base)
    }

    func taxable(_ agi: Double, _ status: Double) -> Double {
        guard let d = deduction, let e = exemption else { return Swift.max(0, agi) }
        var ded = d[key(status, d)]!
        if let po = deductionPhaseout {
            let ab = po[key(status, po)]!
            let cut = ded * Swift.min(1, Swift.max(0, (agi - ab[0]) / (ab[1] - ab[0])))
            if let step = phaseoutRound, step > 0 { ded -= (cut / step).rounded(.down) * step } else { ded -= cut }
        }
        var ex = e[key(status, e)]!
        if let ep = exemptionPhaseout {
            let p = ep[key(status, ep)]!
            ex = Swift.max(0, ex - p[2] * StateTax.steps(agi, p[0], p[1]))
        }
        return Swift.max(0, agi - ded - ex)
    }

    func creditShare(_ agi: Double, _ status: Double) -> Double {
        guard let cr = creditRate else { return 0 }
        var dec = 0.0
        for row in cr[key(status, cr)]! where agi > row[0] || row[0] == 0 { dec = row[1] }
        return dec
    }

    /// Tax from the brackets, with New York's recapture and Connecticut's add-backs and credit.
    func beforeCredit(_ agi: Double, _ status: Double) -> Double {
        let b = brackets![key(status, brackets!)]!
        let x = taxable(agi, status)
        var tax = StateTax.bracketTax(b, x)
        if let rc = recapture {
            if agi > rc.flatAgi {
                tax = x * b[b.count - 1][1]
            } else if agi > rc.agiStart {
                let f = rc.first[key(status, rc.first)]!, j = StateTax.bracketIndex(b, x), ph = rc.phaseIn
                if j <= f {
                    let frac = StateTax.roundHalfUp(Swift.min(agi - rc.agiStart, ph) / ph, 4)
                    tax += (x * b[f][1] - tax) * frac
                } else {
                    let p = StateTax.recaptureParts(b, j)
                    let frac = StateTax.roundHalfUp(Swift.min(Swift.max(0, agi - b[j][0]), ph) / ph, 4)
                    tax += p.base + p.increment * frac
                }
            }
        }
        if let ab = addBack {
            for r in ab[key(status, ab)]! { tax += Swift.min(r[3], r[2] * StateTax.steps(agi, r[0], r[1])) }
        }
        if creditRate != nil { tax *= 1 - creditShare(agi, status) }
        return tax
    }

    public func tax(_ agi: Double, _ status: Double) -> Double {
        guard none != true, brackets != nil, let c = credit else { return 0 }
        return Swift.max(0, beforeCredit(agi, status) - c[key(status, c)]!)
    }

    /// Rate on the next dollar, including recapture and phase-ins (Connecticut's steps spread evenly).
    public func marginal(_ agi: Double, _ status: Double) -> Double {
        guard none != true, let all = brackets else { return 0 }
        let b = all[key(status, all)]!
        let x = taxable(agi, status)
        var rate = b[0][1]
        for row in b where x >= row[0] { rate = row[1] }
        if let rc = recapture {
            let ph = rc.phaseIn
            if agi > rc.flatAgi { return b[b.count - 1][1] }
            if agi > rc.agiStart {
                let f = rc.first[key(status, rc.first)]!, j = StateTax.bracketIndex(b, x)
                if j <= f {
                    let frac = Swift.min(agi - rc.agiStart, ph) / ph
                    rate = rate * (1 - frac) + b[f][1] * frac
                    if agi - rc.agiStart < ph { rate += (x * b[f][1] - StateTax.bracketTax(b, x)) / ph }
                } else if agi - b[j][0] < ph {
                    rate += StateTax.recaptureParts(b, j).increment / ph
                }
            }
            return rate
        }
        if let ep = exemptionPhaseout, let e = exemption {
            let p = ep[key(status, ep)]!
            if x > 0 && agi > p[0] && p[2] * StateTax.steps(agi, p[0], p[1]) < e[key(status, e)]! { rate *= 1 + p[2] / p[1] }
        }
        if let ab = addBack {
            for r in ab[key(status, ab)]! where agi > r[0] && r[2] * StateTax.steps(agi, r[0], r[1]) < r[3] { rate += r[2] / r[1] }
        }
        if creditRate != nil { rate *= 1 - creditShare(agi, status) }
        return rate
    }

    public func gainTax(_ agi: Double, _ gain: Double, _ status: Double) -> Double {
        guard gain > 0 else { return 0 }
        let g = gains
        if let sep = g?.separate { return StateTax.bracketTax(sep.brackets, Swift.max(0, gain - sep.deduction)) }
        if g?.none == true || none == true { return 0 }
        var taxed = gain
        if let cap = g?.exemptAbove { taxed = Swift.min(taxed, cap) }
        if let f = g?.exclude { taxed *= 1 - f }
        if let flat = g?.excludeFlat { taxed = Swift.max(0, taxed - flat) }
        var result: Double
        if let rates = g?.rates, let th = g?.threshold {
            let base = taxable(agi, status)
            let low = Swift.max(0, Swift.min(taxed, th[key(status, th)]! - base))
            result = low * rates[0] + (taxed - low) * rates[1]
        } else {
            result = tax(agi + taxed, status) - tax(agi, status)
        }
        if let cap = g?.maxRate { result = Swift.min(result, gain * cap) }
        if let rate = g?.surtax, let over = g?.agiOver, agi + gain > over { result += gain * rate }
        if let rate = g?.niiSurtax, let over = g?.niiOver { result += Swift.max(0, gain - over) * rate }
        return result
    }
}

extension TaxTable {
    /// The state for a choice value; nil for 0 ("not included").
    public func state(_ value: Double) throws -> StateTax? {
        let v = Int(value)
        if v == 0 { return nil }
        guard let s = states?.list.first(where: { $0.value == v }) else { throw EvalError.message("Unknown state.") }
        return s
    }
    public func stateTax(_ agi: Double, _ status: Double, _ state: Double) throws -> Double { try self.state(state)?.tax(agi, status) ?? 0 }
    public func stateMarginal(_ agi: Double, _ status: Double, _ state: Double) throws -> Double { try self.state(state)?.marginal(agi, status) ?? 0 }
    public func stateGainTax(_ agi: Double, _ gain: Double, _ status: Double, _ state: Double) throws -> Double {
        try self.state(state)?.gainTax(agi, gain, status) ?? 0
    }
}
