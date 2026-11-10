import Foundation

/// Counting functions and the free-form calculator ("scratchpad") used by the Calculator page.
public enum Scientific {
    static func wholeNumber(_ x: Double, _ name: String) throws -> Int {
        guard x >= 0, x.rounded() == x, x <= 170 else {
            throw EvalError.message("\(name) needs a whole number from 0 to 170.")
        }
        return Int(x)
    }

    public static func factorial(_ x: Double) throws -> Double {
        let n = try wholeNumber(x, "Factorial")
        var r = 1.0
        if n >= 2 { for i in 2...n { r *= Double(i) } }
        return r
    }

    public static func combinations(_ nD: Double, _ kD: Double) throws -> Double {
        let n = try wholeNumber(nD, "nCr"), k = try wholeNumber(kD, "nCr")
        guard k <= n else { return 0 }
        let kk = min(k, n - k)
        var r = 1.0
        if kk >= 1 { for i in 1...kk { r = r * Double(n - kk + i) / Double(i) } }
        return r.rounded()
    }

    public static func permutations(_ nD: Double, _ kD: Double) throws -> Double {
        let n = try wholeNumber(nD, "nPr"), k = try wholeNumber(kD, "nPr")
        guard k <= n else { return 0 }
        var r = 1.0
        if k >= 1 { for i in 0..<k { r *= Double(n - i) } }
        return r
    }

    /// Names the calculator defines itself; users can't assign to them.
    public static let reserved: Set<String> = ["ans", "pi", "e"]

    public struct LineResult: Equatable {
        public let assignedName: String?
        public let value: Double
    }

    /// Evaluates one calculator line: an expression, or `name = expression`.
    /// `ans`, `pi`, `e` and saved variables are in scope.
    public static func evaluate(_ line: String, variables: [String: Double], ans: Double?,
                                degrees: Bool, tax: TaxTable) throws -> LineResult {
        var text = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw EvalError.message("Type an expression.") }
        var name: String? = nil
        if let eq = text.firstIndex(of: "="),
           text[text.index(after: eq)...].first != "=",
           eq > text.startIndex, !"<>!=".contains(text[text.index(before: eq)]) {
            let lhs = text[..<eq].trimmingCharacters(in: .whitespaces)
            let isIdentifier = !lhs.isEmpty && (lhs.first!.isLetter || lhs.first! == "_")
                && lhs.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" }
            guard isIdentifier else { throw EvalError.message("Only a name can go on the left of =, like x = 5.") }
            guard !reserved.contains(lhs) else { throw EvalError.message("“\(lhs)” is built in and can't be reassigned.") }
            name = lhs
            text = String(text[text.index(after: eq)...])
        }
        var scope: [String: Value] = ["pi": .number(Double.pi), "e": .number(M_E)]
        for (k, v) in variables { scope[k] = .number(v) }
        if let ans { scope["ans"] = .number(ans) }
        let value = try Expression(text).number(scope, tax: tax, degrees: degrees)
        guard !value.isNaN else { throw EvalError.message("Not a real number (check the inputs, e.g. √ of a negative).") }
        guard value.isFinite else { throw EvalError.message("Result is infinite (division by zero?).") }
        return LineResult(assignedName: name, value: value)
    }

    /// Calculator-style display: grouped digits, up to 10 decimals, scientific notation at the extremes.
    public static func display(_ v: Double) -> String {
        if v == 0 { return "0" }
        let a = abs(v)
        if a >= 1e15 || a < 1e-9 {
            return String(format: "%.10g", v).replacingOccurrences(of: "e+", with: "e")
        }
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        f.maximumFractionDigits = 10
        f.maximumSignificantDigits = 15
        f.usesSignificantDigits = false
        return (f.string(from: NSNumber(value: v)) ?? "\(v)").replacingOccurrences(of: "-", with: "−")
    }
}
