import Foundation

/// Dated federal tax figures, loaded from taxdata.json. Update that file each year.
public struct TaxTable: Codable {
    public struct Limits: Codable {
        public let deferral401k: Double
        public let catchUp401k50: Double
        public let catchUp401k60to63: Double
        public let ira: Double
        public let iraCatchUp50: Double
    }

    public let taxYear: Int
    /// Date (YYYY-MM-DD) these figures were checked against the IRS sources.
    public let verifiedOn: String
    public let sources: [Source]
    /// Caveats, e.g. limits the IRS hasn't published yet.
    public let notes: [String]
    /// Year of the retirement-plan limits in this table (may lag `taxYear`).
    public let limitsYear: Int
    public let statuses: [ChoiceOption]
    public let ordinaryBrackets: [String: [[Double]]]
    public let standardDeduction: [String: Double]
    public let ltcgThresholds: [String: [Double]]
    public let niitThreshold: [String: Double]
    public let niitRate: Double
    public let limits: Limits
    public let giftAnnualExclusion: Double
    public let estateExemption: Double
    public let estateTopRate: Double
    public let uniformLifetime: [String: Double]

    /// Combined tax at the start of each bracket, for checking against the IRS "plus" amounts.
    public func baseAmounts(_ status: Double) throws -> [Double] {
        try brackets(status).map { try incomeTax($0[0], status) }
    }

    private func key(_ status: Double) throws -> String {
        let k = String(Int(status))
        guard ordinaryBrackets[k] != nil else { throw EvalError.message("Unknown filing status.") }
        return k
    }

    public func brackets(_ status: Double) throws -> [[Double]] { ordinaryBrackets[try key(status)]! }

    public func incomeTax(_ income: Double, _ status: Double) throws -> Double {
        let ti = Swift.max(0, income)
        let b = try brackets(status)
        var tax = 0.0
        for i in b.indices {
            let floor = b[i][0], rate = b[i][1]
            let top = i + 1 < b.count ? b[i + 1][0] : Double.infinity
            if ti > floor { tax += (Swift.min(ti, top) - floor) * rate }
        }
        return tax
    }

    public func marginalRate(_ income: Double, _ status: Double) throws -> Double {
        let b = try brackets(status)
        var rate = b[0][1]
        for row in b where income >= row[0] { rate = row[1] }
        return rate
    }

    /// Dollars left before the next bracket; NaN in the top bracket.
    public func bracketRoom(_ income: Double, _ status: Double) throws -> Double {
        let b = try brackets(status)
        for i in b.indices {
            guard i + 1 < b.count else { return .nan }
            let top = b[i + 1][0]
            if income < top { return top - Swift.max(income, 0) }
        }
        return .nan
    }

    public func standardDeduction(_ status: Double) throws -> Double { standardDeduction[try key(status)]! }

    public func ltcgTax(_ ordinary: Double, _ gain: Double, _ status: Double) throws -> Double {
        let t = ltcgThresholds[try key(status)]!
        let t0 = t[0], t15 = t[1]
        let total = ordinary + gain
        let in0 = Swift.max(0, Swift.min(total, t0) - ordinary)
        let in15 = Swift.max(0, Swift.min(total, t15) - Swift.max(ordinary, t0))
        let in20 = Swift.max(0, gain - in0 - in15)
        return 0.15 * in15 + 0.20 * in20
    }

    public func niitThreshold(_ status: Double) throws -> Double { niitThreshold[try key(status)]! }

    public func rmdFactor(_ age: Double) throws -> Double {
        guard let f = uniformLifetime[String(Int(age))] else {
            throw EvalError.message("The Uniform Lifetime Table covers ages 72 to 120.")
        }
        return f
    }

    public func limit401k(_ age: Double) -> Double {
        var extra = 0.0
        if age >= 60 && age <= 63 { extra = limits.catchUp401k60to63 } else if age >= 50 { extra = limits.catchUp401k50 }
        return limits.deferral401k + extra
    }

    public func limitIRA(_ age: Double) -> Double {
        limits.ira + (age >= 50 ? limits.iraCatchUp50 : 0)
    }
}

/// All tax years shipped with the app.
public struct TaxData: Codable {
    /// Year used to compute the catalog's expected values (self-test).
    public let referenceYear: Int
    public let tables: [TaxTable]

    public static func load(from url: URL) throws -> TaxData {
        let d = try JSONDecoder().decode(TaxData.self, from: Data(contentsOf: url))
        guard !d.tables.isEmpty else { throw EvalError.message("taxdata.json has no tax years.") }
        return d
    }

    public var years: [Int] { tables.map(\.taxYear).sorted() }
    public var latestYear: Int { years.last! }

    public func table(for year: Int) -> TaxTable? { tables.first { $0.taxYear == year } }

    /// The current calendar year if loaded; otherwise the newest year not after it; otherwise the oldest.
    public func defaultYear(today: Date = Date()) -> Int {
        let y = Calendar(identifier: .gregorian).component(.year, from: today)
        if table(for: y) != nil { return y }
        return years.last(where: { $0 <= y }) ?? years.first!
    }
}
