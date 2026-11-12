import Foundation
import WealthCore

// Parity harness for the web engine. Evaluates a batch of calculator inputs with the Swift
// engine and writes every result, so web/parity.mjs can compare the JavaScript engine to it.
// Usage: swift run wdparity <Resources dir> <cases.json> <out.json>
// cases.json: {"year": 2026, "cases": [{"calc": "id", "inputs": {"field": "text"}}]}

let args = CommandLine.arguments
// Scenario-file interop: wdparity scenario-write <out> <password> | scenario-read <file> <password>
if args.count == 4 && args[1].hasPrefix("scenario-") {
    let pw = args[3].isEmpty ? nil : args[3]
    if args[1] == "scenario-write" {
        let f = ScenarioFile(calculatorID: "fv_lump", title: "From the Mac app", inputs: ["pv": "10000", "r": "6", "n": "10"])
        try! f.data(password: pw).write(to: URL(fileURLWithPath: args[2]))
    } else {
        let f = try! ScenarioFile.read(Data(contentsOf: URL(fileURLWithPath: args[2])), password: pw)
        print("\(f.calculatorID)|\(f.title)|\(f.inputs.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ","))")
    }
    exit(0)
}
guard args.count == 4 else { print("usage: wdparity <Resources> <cases.json> <out.json>"); exit(2) }
let res = URL(fileURLWithPath: args[1])
let taxData = try! TaxData.load(from: res.appendingPathComponent("taxdata.json"))
let calcs = try! CatalogLoader.load(from: res.appendingPathComponent("catalog.json"))
let input = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[2]))) as! [String: Any]
let engine = Engine(calculators: calcs, taxData: taxData, year: input["year"] as? Int)

/// NaN and ±infinity aren't JSON numbers; encode them as strings.
func num(_ d: Double?) -> Any {
    guard let d else { return NSNull() }
    if d.isNaN { return "NaN" }
    if d.isInfinite { return d > 0 ? "Infinity" : "-Infinity" }
    return d
}

var results: [Any] = []
for case let c as [String: Any] in input["cases"] as! [Any] {
    let calc = engine.calculator(c["calc"] as! String)!
    let ev = engine.evaluate(calc, inputs: c["inputs"] as! [String: String])
    var r: [String: Any] = [
        "fieldErrors": ev.fieldErrors,
        "ruleErrors": ev.ruleErrors,
        "outputs": ev.outputs.map { ["id": $0.id, "value": num($0.value), "error": $0.error ?? NSNull()] as [String: Any] },
    ]
    if let t = ev.table { r["rows"] = t.rows.map { $0.map { num($0) } } }
    results.append(r)
}
try! JSONSerialization.data(withJSONObject: results).write(to: URL(fileURLWithPath: args[3]))
print("evaluated \(results.count) cases")
