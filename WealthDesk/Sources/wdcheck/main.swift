import Foundation
import WealthCore

// Self-test: evaluates every calculator at its example inputs and compares each
// output with the expected value computed by tools/build_catalog.py.
// Usage: swift run wdcheck [path/to/Resources]

let args = CommandLine.arguments
let resources = URL(fileURLWithPath: args.count > 1 ? args[1] : "Resources")
let engine: Engine
do {
    engine = try Engine(catalogURL: resources.appendingPathComponent("catalog.json"),
                        taxURL: resources.appendingPathComponent("taxdata.json"))
} catch {
    print("Could not load catalog: \(error)")
    exit(2)
}

var passed = 0
var failures: [String] = []

func close(_ a: Double, _ b: Double) -> Bool {
    abs(a - b) <= 1e-7 * max(1, abs(b))
}

for calc in engine.calculators {
    let eval = engine.evaluate(calc, inputs: calc.exampleInputs)
    if !eval.fieldErrors.isEmpty || !eval.ruleErrors.isEmpty {
        failures.append("\(calc.id): example inputs rejected: \(eval.fieldErrors) \(eval.ruleErrors)")
        continue
    }
    for o in calc.outputs {
        let got = eval.outputs.first { $0.id == o.id }
        switch (o.expected, got?.value) {
        case (nil, let v?) where v.isNaN: passed += 1
        case (let e?, let v?) where close(v, e): passed += 1
        default:
            failures.append("\(calc.id).\(o.id) \(o.label): expected \(String(describing: o.expected)), got \(String(describing: got?.value)) \(got?.error ?? "")")
        }
    }
    if calc.projection != nil && (eval.table?.rows.isEmpty ?? true) {
        failures.append("\(calc.id): projection produced no table")
    }
}

// Parser and input-handling checks
func expect(_ cond: Bool, _ msg: String) { if cond { passed += 1 } else { failures.append(msg) } }
let dollar = Field(id: "x", label: "x", unit: "$", example: "1", hint: "", min: 0, max: nil, integer: nil, options: nil)
let pct = Field(id: "p", label: "p", unit: "%", example: "1", hint: "", min: nil, max: 1, integer: nil, options: nil)
expect((try? Engine.parse("250k", field: dollar)) == .number(250_000), "250k should parse")
expect((try? Engine.parse("$1.2m", field: dollar)) == .number(1_200_000), "$1.2m should parse")
expect((try? Engine.parse("1,500", field: dollar)) == .number(1500), "1,500 should parse")
expect((try? Engine.parse("7", field: pct)) == .number(0.07), "7 in a % field is 7%")
expect((try? Engine.parse("7%", field: pct)) == .number(0.07), "7% in a % field is 7%")
expect((try? Engine.parse("-5", field: dollar)) == nil, "negative dollars rejected by min 0")
expect((try? Engine.parse("150", field: pct)) == nil, "150% rejected by max 100%")
expect((try? Expression("-2^2").number([:], tax: engine.tax)) == -4, "-2^2 = -4")
expect((try? Expression("2^3^2").number([:], tax: engine.tax)) == 512, "^ is right-associative")
expect((try? Finance.irr([-100, 50, -20, 90])) == nil, "IRR rejects multiple sign changes")

// Market data parsers (sample payloads in the real formats)
let sampleCSV = """
Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"
11/10/2026,4.05,4.16,4.21,4.30,4.28,4.38,4.56,4.73,4.74,4.81,4.89,4.98,5.39,5.35
11/09/2026,4.04,4.13,4.19,4.24,4.20,4.26,4.38,4.56,4.58,4.67,4.76,4.88,5.29,5.26
"""
let curve = MarketParsers.parseTreasuryCSV(sampleCSV)
expect(curve?.date == "11/10/2026", "Treasury CSV: latest date")
expect(curve?.points.count == 14, "Treasury CSV: 14 maturities")
expect(curve.flatMap { $0.rate("10 Yr") }.map { abs($0 - 0.0498) < 1e-12 } == true, "Treasury CSV: 10 Yr = 4.98%")
expect(curve.flatMap { $0.spread("10 Yr", "2 Yr") }.map { abs($0 - 0.0025) < 1e-12 } == true, "Treasury CSV: 10Y-2Y spread")
expect(curve?.prior["10 Yr"].map { abs($0 - 0.0488) < 1e-12 } == true, "Treasury CSV: prior day")
expect(curve?.points.first?.label == "1 Mo" && curve?.points.last?.label == "30 Yr", "Treasury CSV: sorted by maturity")
expect(MarketParsers.parseTreasuryCSV("Date,\"1 Mo\"\n") == nil, "Treasury CSV: empty year returns nil")
let sampleQuote = #"{"chart":{"result":[{"meta":{"currency":"USD","symbol":"VTI","regularMarketPrice":369.55,"chartPreviousClose":370.9,"regularMarketDayHigh":370.555,"regularMarketDayLow":367.06,"fiftyTwoWeekHigh":385.12,"fiftyTwoWeekLow":310.4,"longName":"Vanguard Total Stock Market ETF","regularMarketTime":1794344400}}],"error":null}}"#
let q = try? MarketParsers.parseQuote(Data(sampleQuote.utf8))
expect(q?.price == 369.55 && q?.symbol == "VTI", "Quote: price and symbol")
expect(q.map { abs($0.change - (369.55 - 370.9)) < 1e-9 } == true, "Quote: change vs previous close")
let missing = #"{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}"#
expect((try? MarketParsers.parseQuote(Data(missing.utf8))) == nil, "Quote: unknown symbol throws")
expect(MarketParsers.quoteURL(symbol: "^GSPC") != nil && MarketParsers.quoteURL(symbol: "a/b") == nil, "Quote URL: symbol validation")

// Every Excel template references only known fields
for calc in engine.calculators {
    let ids = Set(calc.fields.map(\.id))
    for o in calc.outputs {
        guard let t = o.excel else { continue }
        let re = try! NSRegularExpression(pattern: "\\{(\\w+)\\}")
        let ns = t as NSString
        let refs = re.matches(in: t, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range(at: 1)) }
        for r in refs where !ids.contains(r) { failures.append("\(calc.id).\(o.id): Excel references unknown {\(r)}") }
    }
}

print("Wealth Desk self-test • \(engine.calculators.count) calculators • tax year \(engine.tax.taxYear)")
if failures.isEmpty {
    print("PASS  \(passed) checks")
} else {
    for f in failures { print("FAIL  \(f)") }
    print("\(passed) passed, \(failures.count) failed")
    exit(1)
}
