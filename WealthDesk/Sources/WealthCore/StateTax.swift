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

    func taxable(_ agi: Double, _ status: Double) -> Double {
        guard let d = deduction, let e = exemption else { return Swift.max(0, agi) }
        var ded = d[key(status, d)]!
        if let po = deductionPhaseout {
            let ab = po[key(status, po)]!
            let cut = ded * Swift.min(1, Swift.max(0, (agi - ab[0]) / (ab[1] - ab[0])))
            if let step = phaseoutRound, step > 0 { ded -= (cut / step).rounded(.down) * step } else { ded -= cut }
        }
        return Swift.max(0, agi - ded - e[key(status, e)]!)
    }

    public func tax(_ agi: Double, _ status: Double) -> Double {
        guard none != true, let b = brackets, let c = credit else { return 0 }
        return Swift.max(0, StateTax.bracketTax(b[key(status, b)]!, taxable(agi, status)) - c[key(status, c)]!)
    }

    public func marginal(_ agi: Double, _ status: Double) -> Double {
        guard none != true, let all = brackets else { return 0 }
        let b = all[key(status, all)]!
        let x = taxable(agi, status)
        var rate = b[0][1]
        for row in b where x >= row[0] { rate = row[1] }
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
