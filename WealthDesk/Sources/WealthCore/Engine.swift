import Foundation

public struct OutputResult: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let format: String
    public let value: Double?
    public let error: String?
}

public struct TableResult: Equatable {
    public let spec: TableSpec
    public let rows: [[Double]]
}

public struct Evaluation: Equatable {
    public var fieldErrors: [String: String] = [:]
    public var ruleErrors: [String] = []
    public var outputs: [OutputResult] = []
    public var table: TableResult? = nil
    /// Parsed input values (series fields omitted), used for copy and history.
    public var values: [String: Double] = [:]

    public var isComplete: Bool { fieldErrors.isEmpty && ruleErrors.isEmpty && !outputs.isEmpty }
}

public final class Engine {
    public let calculators: [Calculator]
    public let tax: TaxTable
    private var compiled: [String: Expression] = [:]

    public init(calculators: [Calculator], tax: TaxTable) {
        self.calculators = calculators
        self.tax = tax
    }

    public convenience init(catalogURL: URL, taxURL: URL) throws {
        self.init(calculators: try CatalogLoader.load(from: catalogURL), tax: try TaxTable.load(from: taxURL))
    }

    public func calculator(_ id: String) -> Calculator? { calculators.first { $0.id == id } }

    func expression(_ source: String) throws -> Expression {
        if let e = compiled[source] { return e }
        let e = try Expression(source)
        compiled[source] = e
        return e
    }

    // MARK: Input parsing

    /// Parses user text for a field. `$`-style inputs accept k/m/b suffixes and
    /// commas; percent fields take percentage points (7 → 0.07) or "7%".
    public static func parse(_ raw: String, field: Field) throws -> Value {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw EvalError.message("Required.") }
        if field.isSeries {
            let parts = text.split(whereSeparator: { $0 == ";" || $0 == "\n" || $0 == "\t" })
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            guard !parts.isEmpty else { throw EvalError.message("Enter at least one value.") }
            return .series(try parts.map { try parseNumber($0, percent: false) })
        }
        let v = try parseNumber(text, percent: field.isPercent)
        if field.integer == true && v.rounded() != v { throw EvalError.message("Use a whole number.") }
        if let lo = field.min, v < lo { throw EvalError.message("Must be at least \(describe(lo, field)).") }
        if let hi = field.max, v > hi { throw EvalError.message("Must be at most \(describe(hi, field)).") }
        if field.isChoice, let opts = field.options, !opts.contains(where: { $0.value == v }) {
            throw EvalError.message("Pick one of the options.")
        }
        return .number(v)
    }

    static func describe(_ v: Double, _ f: Field) -> String {
        f.isPercent ? Format.percent(v) : Format.plain(v)
    }

    public static func parseNumber(_ raw: String, percent: Bool) throws -> Double {
        var s = raw.replacingOccurrences(of: "−", with: "-")
            .replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: " ", with: "")
        var negative = false
        if s.hasPrefix("(") && s.hasSuffix(")") { negative = true; s = String(s.dropFirst().dropLast()) }
        var scale = 1.0
        var hadPercentSign = false
        if s.hasSuffix("%") { hadPercentSign = true; s.removeLast() }
        if let last = s.last?.lowercased() {
            switch last {
            case "k": scale = 1e3; s.removeLast()
            case "m": scale = 1e6; s.removeLast()
            case "b": scale = 1e9; s.removeLast()
            default: break
            }
        }
        guard let d = Double(s), d.isFinite else { throw EvalError.message("Not a number.") }
        var v = d * scale * (negative ? -1 : 1)
        if percent || hadPercentSign { v /= 100 }
        return v
    }

    // MARK: Evaluation

    public func evaluate(_ calc: Calculator, inputs: [String: String]) -> Evaluation {
        var result = Evaluation()
        var scope: [String: Value] = [:]
        for f in calc.fields {
            do {
                let v = try Engine.parse(inputs[f.id] ?? "", field: f)
                scope[f.id] = v
                if case .number(let d) = v { result.values[f.id] = d }
            } catch {
                result.fieldErrors[f.id] = error.localizedDescription
            }
        }
        guard result.fieldErrors.isEmpty else { return result }

        for rule in calc.rules {
            do {
                let l = try expression(rule.left).number(scope, tax: tax)
                let r = try expression(rule.right).number(scope, tax: tax)
                let ok: Bool
                switch rule.relation {
                case "<": ok = l < r
                case "<=": ok = l <= r
                case ">": ok = l > r
                case ">=": ok = l >= r
                case "==": ok = l == r
                default: ok = true
                }
                if !ok { result.ruleErrors.append(rule.message) }
            } catch {
                result.ruleErrors.append(error.localizedDescription)
            }
        }
        guard result.ruleErrors.isEmpty else { return result }

        if let kind = calc.projection {
            do {
                let p = try Projections.run(kind, result.values)
                for (k, v) in p.scalars { scope[k] = .number(v) }
                if let spec = calc.table { result.table = TableResult(spec: spec, rows: p.rows) }
            } catch {
                result.ruleErrors.append(error.localizedDescription)
                return result
            }
        }

        for o in calc.outputs {
            do {
                let v = try expression(o.expression).number(scope, tax: tax)
                if v.isInfinite { throw EvalError.message("Can't be computed with these inputs (division by zero).") }
                result.outputs.append(OutputResult(id: o.id, label: o.label, format: o.format, value: v, error: nil))
            } catch {
                result.outputs.append(OutputResult(id: o.id, label: o.label, format: o.format, value: nil,
                                                   error: error.localizedDescription))
            }
        }
        return result
    }

    // MARK: Excel

    /// Builds a tab-separated grid to paste at A1: inputs in column B, then each
    /// output as a live Excel formula referencing those cells.
    public func excelGrid(_ calc: Calculator, inputs: [String: String]) -> String {
        var lines: [String] = ["\(calc.name)\tWealth Desk"]
        var refs: [String: String] = [:]
        for (i, f) in calc.fields.enumerated() {
            let row = i + 2
            let raw = inputs[f.id] ?? ""
            if f.isSeries, case .series(let s)? = try? Engine.parse(raw, field: f) {
                let cells = s.map { Format.plain($0, maxDecimals: 10) }
                lines.append(([f.label] + cells).joined(separator: "\t"))
                refs[f.id] = "B\(row):\(Engine.column(cells.count))\(row)"
            } else {
                var cell = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                if let v = try? Engine.parse(raw, field: f), case .number(let d) = v {
                    cell = f.isPercent ? Format.plain(d * 100, maxDecimals: 10) + "%" : Format.plain(d, maxDecimals: 10)
                }
                lines.append("\(f.label)\t\(cell)")
                refs[f.id] = "B\(row)"
            }
        }
        lines.append("")
        let eval = evaluate(calc, inputs: inputs)
        for o in calc.outputs {
            if let template = o.excel {
                lines.append("\(o.label)\t\(Engine.resolve(template, refs))")
            } else {
                let v = eval.outputs.first { $0.id == o.id }?.value
                let text = v.map { $0.isNaN ? "n/a" : Format.plain($0, maxDecimals: 10) } ?? ""
                lines.append("\(o.label)\t\(text)\tvalue from Wealth Desk (no Excel formula)")
            }
        }
        return lines.joined(separator: "\n")
    }

    /// Excel formula with example cell references, for the Details panel.
    public func excelFormula(_ calc: Calculator, _ output: Output) -> String? {
        guard let t = output.excel else { return nil }
        var refs: [String: String] = [:]
        for (i, f) in calc.fields.enumerated() {
            let row = i + 2
            if f.isSeries {
                let n = f.example.split(separator: ";").count
                refs[f.id] = "B\(row):\(Engine.column(n))\(row)"
            } else {
                refs[f.id] = "B\(row)"
            }
        }
        return Engine.resolve(t, refs)
    }

    static func resolve(_ template: String, _ refs: [String: String]) -> String {
        var out = template
        for (k, v) in refs { out = out.replacingOccurrences(of: "{\(k)}", with: v) }
        return out
    }

    /// Column letter for the n-th value cell starting at B (1 → B).
    static func column(_ n: Int) -> String {
        var index = n + 1  // B is column 2
        var s = ""
        while index > 0 {
            let r = (index - 1) % 26
            s = String(UnicodeScalar(65 + r)!) + s
            index = (index - 1) / 26
        }
        return s
    }

    public func tableTSV(_ table: TableResult) -> String {
        var lines = [table.spec.columns.map(\.label).joined(separator: "\t")]
        for row in table.rows {
            lines.append(row.map { Format.plain($0, maxDecimals: 2) }.joined(separator: "\t"))
        }
        return lines.joined(separator: "\n")
    }
}

// MARK: - Formatting

public enum Format {
    public static func value(_ v: Double?, _ format: String) -> String {
        guard let v else { return "—" }
        if v.isNaN { return "n/a" }
        switch format {
        case "currency": return currency(v)
        case "percent": return percent(v)
        case "years": return plain(v, maxDecimals: 2) + (abs(v - 1) < 1e-9 ? " year" : " years")
        case "age": return v < 0 ? "Never" : plain(v, maxDecimals: 1)
        case "multiple": return plain(v, maxDecimals: 2) + "×"
        default: return plain(v, maxDecimals: 4)
        }
    }

    public static func currency(_ v: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.locale = Locale(identifier: "en_US")
        let digits = (abs(v) >= 1000 || v == 0) ? 0 : 2
        f.minimumFractionDigits = digits
        f.maximumFractionDigits = digits
        let s = f.string(from: NSNumber(value: v)) ?? "\(v)"
        return s.replacingOccurrences(of: "-", with: "−")
    }

    public static func percent(_ v: Double) -> String {
        plain(v * 100, maxDecimals: 2) + "%"
    }

    public static func plain(_ v: Double, maxDecimals: Int = 4) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.usesGroupingSeparator = maxDecimals <= 4
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = maxDecimals
        let s = f.string(from: NSNumber(value: v)) ?? "\(v)"
        return maxDecimals <= 4 ? s.replacingOccurrences(of: "-", with: "−") : s
    }
}
