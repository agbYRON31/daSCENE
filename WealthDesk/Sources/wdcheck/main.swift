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
