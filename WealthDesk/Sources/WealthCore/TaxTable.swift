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

    /// Alternative minimum tax figures (IRC §55) from the IRS revenue procedure.
    public struct AMT: Codable {
        public let exemption: [String: Double]
        public let phaseoutStart: [String: Double]
        public let phaseoutRate: Double
        public let rateBreak: Double
        public let rates: [Double]
    }

    /// Medicare premiums and IRMAA tiers from CMS's yearly fact sheets; the table's year is the premium year.
    public struct Medicare: Codable {
        public let partB: Double
        public let partBDeductible: Double
        public let partDBase: Double
        public let irmaaThresholds: [String: [Double]]
        public let partBAdjust: [Double]
        public let partDAdjust: [Double]
    }

    /// HSA contribution limits (IRS revenue procedure) and the age-55 catch-up.
    public struct HSA: Codable {
        public let selfOnly: Double
        public let family: Double
        public let catchUp55: Double
        enum CodingKeys: String, CodingKey { case selfOnly = "self", family, catchUp55 }
    }

    /// Additional Medicare tax (Form 8959): thresholds set by statute, not indexed.
    public struct AddlMedicare: Codable {
        public let rate: Double
        public let threshold: [String: Double]
        public let withholdingThreshold: Double
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
    public let amt: AMT
    public let medicare: Medicare
    public let hsa: HSA
    public let addlMedicare: AddlMedicare
    public let limits: Limits
    public let giftAnnualExclusion: Double
    public let estateExemption: Double
    public let estateTopRate: Double
    public let uniformLifetime: [String: Double]
    /// State income tax tables (tools/state_tax_data.py); see StateTax.swift.
    public let states: StateTaxes?

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

    /// IRMAA tier 0–5: the first four thresholds are crossed by income above them, the top one at or above it (CMS tables).
    public func irmaaTier(_ magi: Double, _ status: Double) throws -> Double {
        guard let t = medicare.irmaaThresholds[try key(status)], t.count == 5 else { throw EvalError.message("Unknown filing status.") }
        return Double(t.prefix(4).filter { magi > $0 }.count + (magi >= t[4] ? 1 : 0))
    }
    public func partBPremium(_ magi: Double, _ status: Double) throws -> Double {
        medicare.partB + medicare.partBAdjust[Int(try irmaaTier(magi, status))]
    }
    public func partDIrmaa(_ magi: Double, _ status: Double) throws -> Double {
        medicare.partDAdjust[Int(try irmaaTier(magi, status))]
    }
    /// Income that can be added before the next tier's threshold (0 in the top tier).
    public func irmaaRoom(_ magi: Double, _ status: Double) throws -> Double {
        let k = Int(try irmaaTier(magi, status))
        return k >= 5 ? 0 : Swift.max(0, medicare.irmaaThresholds[try key(status)]![k] - magi)
    }
    public func addlMedicareThreshold(_ status: Double) throws -> Double { addlMedicare.threshold[try key(status)]! }
    /// 1 = self-only coverage, 2 = family coverage.
    public func hsaLimit(_ coverage: Double) -> Double { Int(coverage) == 1 ? hsa.selfOnly : hsa.family }

    /// AMT exemption after the phase-out (same rule as amtexemption in tools/build_catalog.py).
    public func amtExemption(_ amti: Double, _ status: Double) throws -> Double {
        let k = try key(status)
        return Swift.max(0, amt.exemption[k]! - amt.phaseoutRate * Swift.max(0, amti - amt.phaseoutStart[k]!))
    }

    /// Tentative minimum tax: lower rate up to rateBreak of the excess over the exemption, higher rate above.
    public func amtTax(_ amti: Double, _ status: Double) throws -> Double {
        let base = Swift.max(0, amti - (try amtExemption(amti, status)))
        return amt.rates[0] * Swift.min(base, amt.rateBreak) + amt.rates[1] * Swift.max(0, base - amt.rateBreak)
    }

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

    /// Loads taxdata.json and attaches the state tables from statetax.json in the same folder, if present.
    public static func load(from url: URL) throws -> TaxData {
        var data = try Data(contentsOf: url)
        let stateURL = url.deletingLastPathComponent().appendingPathComponent("statetax.json")
        if let stateData = try? Data(contentsOf: stateURL) {
            data = try withStates(data, stateData)
        }
        let d = try JSONDecoder().decode(TaxData.self, from: data)
        guard !d.tables.isEmpty else { throw EvalError.message("taxdata.json has no tax years.") }
        return d
    }

    /// Same rule as with_states in tools/build_catalog.py and withStates in web/engine.js.
    static func withStates(_ taxJSON: Data, _ stateJSON: Data) throws -> Data {
        guard var root = try JSONSerialization.jsonObject(with: taxJSON) as? [String: Any],
              let tables = root["tables"] as? [[String: Any]],
              let states = try JSONSerialization.jsonObject(with: stateJSON) as? [String: Any],
              let year = states["taxYear"] as? Int else { return taxJSON }
        root["tables"] = tables.map { t -> [String: Any] in
            var t = t, st = states
            if let ty = t["taxYear"] as? Int, ty != year {
                st["notes"] = ["\(ty) state figures are not yet published; \(year) state tables are used."] + ((states["notes"] as? [String]) ?? [])
            }
            t["states"] = st
            return t
        }
        return try JSONSerialization.data(withJSONObject: root)
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
