import Foundation

/// Ordered JSON value used to build the dashboard model exactly like engine.py's dicts.
public indirect enum JSONValue: Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([(String, JSONValue)])

    public static func == (a: JSONValue, b: JSONValue) -> Bool {
        switch (a, b) {
        case (.null, .null): return true
        case let (.bool(x), .bool(y)): return x == y
        case let (.number(x), .number(y)): return x == y
        case let (.string(x), .string(y)): return x == y
        case let (.array(x), .array(y)): return x == y
        case let (.object(x), .object(y)): return x.count == y.count && zip(x, y).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
        default: return false
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let kv) = self { return kv.first { $0.0 == key }?.1 }
        return nil
    }

    public var double: Double? { if case .number(let d) = self { return d }; return nil }
    public var string: String? { if case .string(let s) = self { return s }; return nil }
    public var array: [JSONValue]? { if case .array(let a) = self { return a }; return nil }

    /// engine.r1: NaN/inf → null, else Python round(x, d).
    public static func r(_ x: Double?, _ d: Int = 1) -> JSONValue {
        guard let x, x.isFinite else { return .null }
        return .number(Ops.pyRound(x, d))
    }

    public static func str(_ s: String?) -> JSONValue { s.map(JSONValue.string) ?? .null }
    public static func int(_ i: Int) -> JSONValue { .number(Double(i)) }
    public static func num(_ d: Double) -> JSONValue { d.isFinite ? .number(d) : .null }

    public func serialized(pretty: Bool = false) -> Data {
        var out = ""
        write(&out, pretty: pretty, indent: 0)
        return Data(out.utf8)
    }

    private func write(_ out: inout String, pretty: Bool, indent: Int) {
        let nl = pretty ? "\n" + String(repeating: " ", count: indent + 1) : ""
        let close = pretty ? "\n" + String(repeating: " ", count: indent) : ""
        switch self {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .number(let d):
            if d == d.rounded(), abs(d) < 1e15 { out += String(Int(d)) } else { out += "\(d)" }
        case .string(let s): out += Self.escape(s)
        case .array(let a):
            if a.isEmpty { out += "[]"; return }
            out += "["
            for (i, v) in a.enumerated() {
                if i > 0 { out += "," }
                out += nl
                v.write(&out, pretty: pretty, indent: indent + 1)
            }
            out += close + "]"
        case .object(let kv):
            if kv.isEmpty { out += "{}"; return }
            out += "{"
            for (i, (k, v)) in kv.enumerated() {
                if i > 0 { out += "," }
                out += nl + Self.escape(k) + (pretty ? ": " : ":")
                v.write(&out, pretty: pretty, indent: indent + 1)
            }
            out += close + "}"
        }
    }

    static func escape(_ s: String) -> String {
        var r = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": r += "\\\""
            case "\\": r += "\\\\"
            case "\n": r += "\\n"
            case "\r": r += "\\r"
            case "\t": r += "\\t"
            case "<": r += "\\u003c"   // safe inside an HTML <script> block
            default:
                if u.value < 0x20 { r += String(format: "\\u%04x", u.value) } else { r.unicodeScalars.append(u) }
            }
        }
        return r + "\""
    }
}
