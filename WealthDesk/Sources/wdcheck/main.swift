import Foundation
import WealthCore

// Self-test: evaluates every calculator at its example inputs and compares each
// output with the expected value computed by tools/build_catalog.py.
// Usage: swift run wdcheck [path/to/Resources]

let args = CommandLine.arguments
let resources = URL(fileURLWithPath: args.count > 1 ? args[1] : "Resources")
let engine: Engine
let taxData: TaxData
do {
    taxData = try TaxData.load(from: resources.appendingPathComponent("taxdata.json"))
    // Expected values were computed with the reference year, so test with it.
    engine = Engine(calculators: try CatalogLoader.load(from: resources.appendingPathComponent("catalog.json")),
                    taxData: taxData, year: taxData.referenceYear)
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

// Scientific calculator
func calc(_ line: String, vars: [String: Double] = [:], ans: Double? = nil, deg: Bool = false) -> Double? {
    try? Scientific.evaluate(line, variables: vars, ans: ans, degrees: deg, tax: engine.tax).value
}
func near(_ a: Double?, _ b: Double) -> Bool { a.map { abs($0 - b) <= 1e-9 * max(1, abs(b)) } ?? false }
expect(near(calc("sin(30)", deg: true), 0.5), "sin 30° = 0.5")
expect(near(calc("cos(pi)"), -1), "cos π = −1 (radians)")
expect(near(calc("atan(1)", deg: true), 45), "atan 1 = 45°")
expect(near(calc("log(1000)"), 3) && near(calc("log(8, 2)"), 3) && near(calc("ln(e)"), 1), "log10, log base b, ln e")
expect(calc("fact(5)") == 120 && calc("ncr(5, 2)") == 10 && calc("npr(5, 2)") == 20, "factorial / nCr / nPr")
expect(calc("fact(2.5)") == nil, "factorial rejects non-integers")
expect(calc("mod(-7, 3)") == 2 && calc("round(2.345, 2)") == 2.35, "mod and round")
expect(calc("6 × 7 − 2 ÷ 4") == 41.5, "typographic × ÷ − operators")
expect(near(calc("2π"), .nan) == false && calc("2*π") != nil, "π symbol is accepted")
expect(calc("ans * 2", ans: 21) == 42, "ans holds the last result")
expect(calc("x^2 + 1", vars: ["x": 3]) == 10, "variables")
// Typing the way people type on a keyboard (Calculator page only; the catalog formula language is unchanged).
func line(_ text: String, vars: [String: Double] = [:], ans: Double? = nil) -> Scientific.LineResult? {
    try? Scientific.evaluate(text, variables: vars, ans: ans, degrees: false, tax: engine.tax)
}
func message(_ text: String, vars: [String: Double] = [:]) -> String {
    do { _ = try Scientific.evaluate(text, variables: vars, ans: nil, degrees: false, tax: engine.tax); return "" }
    catch { return error.localizedDescription }
}
expect(calc("r = 5%") == 0.05 && calc("50%") == 0.5 && calc("200 * 15%") == 30, "% means ÷ 100")
expect(calc("5 x 3") == 15 && calc("5x3") == 15 && calc("5 X 3") == 15 && calc("(2)x(4)") == 8, "x between numbers multiplies")
expect(calc("x = 5")  == 5 && line("x = 5")?.assignedName == "x", "x can still be a variable name")
expect(calc("x^2 + 1", vars: ["x": 3]) == 10 && calc("2 * x", vars: ["x": 3]) == 6 && calc("x", vars: ["x": 3]) == 3, "x as a variable")
expect(calc("2x", vars: ["x": 3]) == 6 && calc("3x + 1", vars: ["x": 2]) == 7, "number next to a variable multiplies")
expect(calc("x x 2", vars: ["x": 3]) == 6 && calc("2 x x", vars: ["x": 3]) == 6, "x times x-the-variable")
expect(calc("k = 4") == 4 && calc("2 * k", vars: ["k": 4]) == 8 && calc("k + 1", vars: ["k": 4]) == 5, "k as a variable")
expect(calc("2k", vars: ["k": 4]) == 8, "a defined variable wins over the k suffix")
expect(calc("250k") == 250_000 && calc("1.2m") == 1_200_000 && calc("3b") == 3e9 && calc("2K + 1") == 2001, "k / m / b suffixes")
expect(calc("2(3 + 4)") == 14 && calc("(1 + 2)(3 + 4)") == 21 && near(calc("2pi"), 2 * .pi) && calc("2 sqrt(9)") == 6, "implicit multiplication")
expect(calc("5 x -3") == -15 && calc("2 x - 1", vars: ["x": 3]) == 5, "x before a sign")
expect(calc("1e-05") == 0.00001 && calc("2 * (-5)") == -10, "re-inserted results")
expect(message("2 3").isEmpty == false, "two numbers in a row are still an error")
expect(calc("5 + 3 =") == 8 && calc("y = 2 + 3 =") == 5, "a trailing = is ignored")
expect(calc("limit401k(2026)") != nil, "function names with digits and k are not split")
expect(calc("2e3") == 2000 && near(calc("2e"), 2 * M_E), "scientific notation vs. e")
expect(message("z + 1").contains("z = "), "unset variable explains how to set it")
expect(message("5 x").contains("×") || message("5 x").contains("*"), "dangling x hints at ×")
expect((try? Scientific.evaluate("y = 2^10", variables: [:], ans: nil, degrees: false, tax: engine.tax))?.assignedName == "y", "assignment")
expect((try? Scientific.evaluate("pi = 3", variables: [:], ans: nil, degrees: false, tax: engine.tax)) == nil, "built-ins can't be reassigned")
expect(calc("sqrt(-1)") == nil && calc("1/0") == nil, "NaN and infinity are errors")
expect(calc("3 >= 2") == 1, "comparisons still work")
expect(Scientific.display(0.1 + 0.2) == "0.3" && Scientific.display(1234567.5) == "1,234,567.5", "calculator display")

// Tax tables vs. the IRS revenue procedures: tax at the start of each bracket must equal
// the "$X plus N% of the excess" base amounts printed by the IRS.
let irsBase: [Int: [Int: [Double]]] = [
    2026: [ // Rev. Proc. 2025-32, section 4.01
        1: [0, 1_240, 5_800, 17_966, 41_024, 58_448, 192_979.25],
        2: [0, 2_480, 11_600, 35_932, 82_048, 116_896, 206_583.50],
        3: [0, 1_770, 7_740, 16_155, 39_207, 56_631, 191_171],
    ],
    2027: [ // Rev. Proc. 2026-35, section 3.01
        1: [0, 1_280, 5_987, 18_549, 42_357, 60_349, 199_237.75],
        2: [0, 2_560, 11_974, 37_098, 84_714, 120_698, 213_290.50],
        3: [0, 1_825, 7_993, 16_672, 40_480, 58_480, 197_360],
    ],
]
for (year, byStatus) in irsBase.sorted(by: { $0.key < $1.key }) {
    guard let table = taxData.table(for: year) else { failures.append("Tax year \(year) missing from taxdata.json"); continue }
    for (status, expected) in byStatus.sorted(by: { $0.key < $1.key }) {
        let got = (try? table.baseAmounts(Double(status))) ?? []
        expect(got.count == expected.count && zip(got, expected).allSatisfy { abs($0 - $1) < 0.005 },
               "\(year) status \(status) bracket base amounts match the IRS: got \(got)")
    }
    expect(!table.sources.isEmpty && table.verifiedOn.count == 10, "\(year) table cites IRS sources and a verification date")
}
// Selecting a tax year changes the figures; unknown years are refused.
let switcher = Engine(calculators: [], taxData: taxData, year: 2026)
expect(switcher.tax.standardDeduction["2"] == 32_200, "2026 MFJ standard deduction")
expect(switcher.selectTaxYear(2027) && switcher.tax.standardDeduction["2"] == 33_200, "2027 MFJ standard deduction")
expect(!switcher.selectTaxYear(1999) && switcher.tax.taxYear == 2027, "unknown tax year is refused")
expect(taxData.defaultYear(today: ISO8601DateFormatter().date(from: "2026-11-10T12:00:00Z")!) == 2026, "default year = current year")
expect(taxData.defaultYear(today: ISO8601DateFormatter().date(from: "2031-03-01T12:00:00Z")!) == taxData.latestYear, "default year falls back to newest")

// IRS.gov launch check
let newsroom = "<li><a href=\"/x\">IRS releases tax inflation adjustments for tax year 2027; taxpayers continue to benefit</a></li><li>IR-2025-111, 401(k) limit increases to $24,500 for 2026, IRA limit increases to $7,500</li><li>IRS provides tax inflation adjustments for tax year 2024</li>"
let pub = IRSCheck.parse(html: newsroom)
expect(pub == IRSCheck.Published(taxYear: 2027, limitsYear: 2026), "IRS page parse: newest tax and limits years (\(pub))")
expect(IRSCheck.compare(pub, data: taxData) == [.upToDate], "loaded data is current against that page")
let future = IRSCheck.Published(taxYear: 2028, limitsYear: 2027)
expect(IRSCheck.compare(future, data: taxData) == [.newerTaxYear(published: 2028, loaded: 2027), .newerLimits(published: 2027, loaded: 2026)],
       "newer IRS releases are flagged")
expect(IRSCheck.parse(html: "<p>nothing here</p>") == IRSCheck.Published(), "page without releases parses to nothing")

// RoRo: the Swift port must reproduce the original Python engine (tools/roro_reference) on a fixed
// data snapshot. Expected files were generated by tools/roro_reference/py_model.py on Tests/roro_fixture.
let tests = resources.deletingLastPathComponent().appendingPathComponent("Tests")
let fixture = RoRoFetcher.loadCache(tests.appendingPathComponent("roro_fixture"))
expect(fixture.fredRawSeries.count == 18 && fixture.yahooRawSeries.count == 42, "RoRo fixture loads all 60 series")
for (name, day) in [("roro_expected.json", nil as Day?), ("roro_expected_2022-06-16.json", DayMath.day(2022, 6, 16))] {
    guard let ref = try? Data(contentsOf: tests.appendingPathComponent(name)) else { failures.append("missing \(name)"); continue }
    let data = day.map { fixture.truncated(through: $0) } ?? fixture
    let diffs = RoRoParity.differences(RoRoEngine.build(data, lastRun: nil), reference: ref)
    expect(diffs.isEmpty, "RoRo matches Python engine (\(name)): \(diffs.prefix(5).joined(separator: "; "))")
}
for f in RoRoConfig.factors {
    let series = RoRoConfig.factorSeries[f.id] ?? []
    let known = series.allSatisfy { $0.source == "FRED" ? RoRoSources.fredSeries.contains($0.id) : RoRoSources.yahooTickers.contains($0.id) }
    expect(!series.isEmpty && known, "RoRo factor \(f.id) lists its data series")
}
// Scenario files: plain and password-protected round trips
let scenario = ScenarioFile(calculatorID: "fv_lump", title: "Test", inputs: ["p": "1000", "r": "5", "n": "10"], saved: Date(timeIntervalSince1970: 1_700_000_000))
expect((try? ScenarioFile.read(scenario.data())) == scenario, "scenario file round trip")
let sealed = try? scenario.data(password: "correct horse battery")
expect(sealed.map(ScenarioFile.isEncrypted) == true && sealed.map { !String(decoding: $0, as: UTF8.self).contains("fv_lump") } == true,
       "protected scenario file is encrypted (no plaintext)")
expect(sealed.flatMap { try? ScenarioFile.read($0, password: "correct horse battery") } == scenario, "protected scenario opens with the password")
expect(sealed.flatMap { try? ScenarioFile.read($0, password: "wrong") } == nil && sealed.flatMap { try? ScenarioFile.read($0) } == nil,
       "protected scenario refuses a wrong or missing password")
expect((try? ScenarioFile.read(Data("{}".utf8))) == nil, "non-scenario JSON is rejected")

// RoRo primitives against pandas semantics
expect(Ops.ewm([1, 2, .nan, 4], span: 5).map { Ops.pyRound($0, 6) } == [1, 1.6, 1.6, 2.978723], "ewm matches pandas (adjust=True)")
expect(Ops.align(TimeSeries(days: [0, 10], values: [1, 2]), to: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], limit: 5)!
         .map { $0.isNaN ? -1 : $0 } == [1, 1, 1, 1, 1, 1, -1, -1, -1, -1, 2], "forward fill respects limit")
expect(Ops.pyRound(2.5, 0) == 2 && Ops.pyRound(3.5, 0) == 4 && Ops.pyRound(0.125, 2) == 0.12, "Python banker's rounding")
expect(DayMath.subtractMonths(DayMath.day(2026, 3, 31), 1) == DayMath.day(2026, 2, 28), "month offset clips to month end")

// Edge cases: zero and tiny rates, negative returns, long horizons, solver limits, invalid inputs
func approx(_ a: Double, _ b: Double, _ tol: Double = 1e-9) -> Bool { abs(a - b) <= tol * max(1, abs(b)) }
expect(Finance.fv(0, 10, 100, 1000) == 2000 && Finance.pv(0, 10, 100) == 1000 && Finance.pmt(0, 10, 1000) == 100, "zero-rate TVM")
let tinyPV: Double = Finance.pv(1e-12, 360, 1000)
let tinyFV: Double = Finance.fv(1e-12, 360, 1000, 0)
let tinyPMT: Double = Finance.pmt(1e-12, 360, 360_000)
expect(approx(tinyPV, 360_000) && approx(tinyFV, 360_000) && approx(tinyPMT, 1000), "tiny-rate TVM keeps precision")
expect(approx(Finance.fv(-0.05, 10, 0, 1000), 1000 * pow(0.95, 10)), "negative return compounding")
let century: Double = Finance.fv(0.07, 100, 0, 1)
expect(century.isFinite && approx(century, pow(1.07, 100), 1e-12), "100-year horizon")
expect(approx(Finance.pmt(0.06 / 12, 360, 300_000), 1798.6515754582708, 1e-10), "30-year mortgage payment (textbook value $1,798.65)")
expect(approx(Finance.nper(0.07, 0, 1, 2), log(2) / log(1.07)), "nper doubling time")
expect((try? Finance.rate(12, 100, -5)) == nil, "rate() refuses inputs with no solution in range")
expect((try? Finance.rate(360, 1798.6515754582708, 300_000)).map { approx($0 * 12, 0.06, 1e-9) } == true, "rate() recovers 6% mortgage rate")
expect((try? Finance.bondYTM(1, 1000, 0.04, 10, 2)) == nil, "bond YTM refuses a price no yield in range can match")
expect((try? Finance.bondYTM(1000, 1000, 0.04, 10, 2)).map { approx($0, 0.04, 1e-9) } == true, "par bond yields its coupon")
expect((try? Finance.irr([-100, 1e9])) == nil, "IRR refuses returns beyond its solvable range")
expect((try? Finance.irr([-1000, 1100])).map { approx($0, 0.10, 1e-9) } == true, "one-period IRR = 10%")
func evalCalc(_ id: String, _ inputs: [String: String]) -> Evaluation? { engine.calculator(id).map { engine.evaluate($0, inputs: inputs) } }
expect(evalCalc("fv_lump", ["p": "100000", "r": "0", "n": "30"])?.outputs.first?.value == 100_000, "0% growth leaves the amount unchanged")
expect(evalCalc("fv_lump", ["p": "abc", "r": "7", "n": "20"])?.fieldErrors["p"] != nil, "non-numeric input is rejected")
expect(evalCalc("fv_lump", ["p": "", "r": "7", "n": "20"])?.isComplete == false, "blank input produces no result")
expect(evalCalc("cagr", ["s": "0", "e": "100", "n": "5"])?.fieldErrors["s"] != nil, "CAGR rejects a zero starting value")
expect(evalCalc("years_to_goal", ["p": "0", "c": "0", "g": "100", "r": "5"])?.outputs.first?.error != nil, "impossible goal shows an error, not a number")
expect(evalCalc("longevity", ["b": "1000000", "w": "30000", "r": "5"])?.ruleErrors.isEmpty == false, "withdrawals below the return never deplete (rule)")
expect(evalCalc("portfolio_stress", ["v": "2m", "we": "60", "wb": "40", "eq": "-20", "dy": "0", "dur": "6", "infl": "0", "w": "0"])?.outputs[2].value == -240_000,
       "$2M 60/40 with stocks −20%: −$240,000")
expect(evalCalc("portfolio_stress", ["v": "2m", "we": "40", "wb": "60", "eq": "-20", "dy": "0", "dur": "6", "infl": "0", "w": "0"])?.outputs[2].value == -160_000,
       "$2M 40/60 with stocks −20%: −$160,000")
expect(evalCalc("portfolio_stress", ["v": "2m", "we": "70", "wb": "40", "eq": "-20", "dy": "0", "dur": "6", "infl": "0", "w": "0"])?.ruleErrors.isEmpty == false,
       "allocation above 100% is rejected")
for c in engine.calculators {
    let blank = engine.evaluate(c, inputs: c.blankInputs)
    expect(!blank.isComplete && blank.outputs.isEmpty, "\(c.id): blank inputs show no numbers")
}

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
