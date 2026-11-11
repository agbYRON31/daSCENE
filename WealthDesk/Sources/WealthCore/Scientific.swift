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
    /// `ans`, `pi`, `e` and saved variables are in scope. The line is first read the way people
    /// type on a keyboard (see `rewrite`); the catalog formula language itself is unchanged.
    public static func evaluate(_ line: String, variables: [String: Double], ans: Double?,
                                degrees: Bool, tax: TaxTable) throws -> LineResult {
        var text = stripTrailingEquals(line.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !text.isEmpty else { throw EvalError.message("Type an expression.") }
        var name: String? = nil
        if let eq = text.firstIndex(of: "="),
           text[text.index(after: eq)...].first != "=",
           eq > text.startIndex, !"<>!=".contains(text[text.index(before: eq)]) {
            let lhs = text[..<eq].trimmingCharacters(in: .whitespaces)
            guard isName(lhs) else { throw EvalError.message("Only a name can go on the left of =, like x = 5.") }
            guard !reserved.contains(lhs) else { throw EvalError.message("“\(lhs)” is built in and can't be reassigned.") }
            name = lhs
            text = String(text[text.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            guard !text.isEmpty else { throw EvalError.message("Type a value after =, like \(lhs) = 5.") }
        }
        var scope: [String: Value] = ["pi": .number(Double.pi), "e": .number(M_E)]
        for (k, v) in variables { scope[k] = .number(v) }
        if let ans { scope["ans"] = .number(ans) }
        let rewritten = try rewrite(text, names: Set(scope.keys))
        let value = try Expression(rewritten).number(scope, tax: tax, degrees: degrees)
        guard !value.isNaN else { throw EvalError.message("Not a real number (check the inputs, e.g. √ of a negative).") }
        guard value.isFinite else { throw EvalError.message("Result is infinite (division by zero?).") }
        return LineResult(assignedName: name, value: value)
    }

    /// True for a valid variable name (letters, digits and _; not starting with a digit).
    public static func isName<S: StringProtocol>(_ s: S) -> Bool {
        guard let f = s.first, f.isLetter || f == "_" else { return false }
        return s.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" }
    }

    /// "5 + 3 =" → "5 + 3". Leaves comparison operators (<=, >=, ==, !=) alone.
    public static func stripTrailingEquals(_ s: String) -> String {
        var t = s
        while t.hasSuffix("="), t.count >= 1 {
            let before = t.dropLast().last
            if let b = before, "<>!=".contains(b) { break }
            t = String(t.dropLast()).trimmingCharacters(in: .whitespaces)
        }
        return t
    }

    private enum Tok: Equatable {
        case num(String), name(String), op(String), lparen, rparen, comma, percent, raw(String)
    }

    private static let suffixes: [Character: String] = ["k": "1000", "K": "1000", "m": "1000000", "M": "1000000",
                                                        "b": "1000000000", "B": "1000000000"]

    /// Reads a calculator line the way people type it and returns it in the strict formula language:
    /// - `x` or `X` between two values means ×: `5 x 3`, `5x3`, `(2)x(4)`. Anywhere else `x` is a variable.
    /// - k, m and b right after a number scale it: `250k`, `1.2m`, `3b` (a variable with that name wins).
    /// - A value next to a name or bracket multiplies: `2x`, `2pi`, `2(3 + 4)`, `(1 + 2)(3 + 4)`.
    /// - `%` divides by 100: `15%` is 0.15.
    /// Names that aren't set produce a message saying how to set them.
    static func rewrite(_ text: String, names: Set<String>) throws -> String {
        let chars = Array(text.replacingOccurrences(of: "×", with: "*").replacingOccurrences(of: "÷", with: "/")
            .replacingOccurrences(of: "−", with: "-").replacingOccurrences(of: "π", with: "pi"))
        var toks: [Tok] = []
        func endsOperand(_ t: Tok?) -> Bool {
            switch t {
            case .num?, .rparen?, .percent?: return true
            case .name?: return true
            default: return false
            }
        }
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c.isWhitespace { i += 1; continue }
            if c.isNumber || (c == "." && i + 1 < chars.count && chars[i + 1].isNumber) {
                var j = i
                while j < chars.count && (chars[j].isNumber || chars[j] == ".") { j += 1 }
                if j < chars.count && (chars[j] == "e" || chars[j] == "E") {
                    var k = j + 1
                    if k < chars.count && (chars[k] == "+" || chars[k] == "-") { k += 1 }
                    if k < chars.count && chars[k].isNumber {
                        j = k
                        while j < chars.count && chars[j].isNumber { j += 1 }
                    }
                }
                let number = String(chars[i..<j])
                // 250k / 1.2m / 3b, unless the letter starts a longer name or is a variable the user set.
                if j < chars.count, let scale = suffixes[chars[j]], !names.contains(String(chars[j])),
                   !(j + 1 < chars.count && (chars[j + 1].isLetter || chars[j + 1].isNumber || chars[j + 1] == "_")) {
                    toks += [.lparen, .num(number), .op("*"), .num(scale), .rparen]
                    i = j + 1
                } else {
                    toks.append(.num(number)); i = j
                }
                continue
            }
            if c.isLetter || c == "_" {
                var j = i
                while j < chars.count && (chars[j].isLetter || chars[j].isNumber || chars[j] == "_") { j += 1 }
                let word = String(chars[i..<j])
                // "5x3": x glued to the next number is a times sign, not a name like x3.
                if (c == "x" || c == "X"), word.count > 1, chars[i + 1].isNumber, !names.contains(word), endsOperand(toks.last) {
                    toks.append(.op("*")); i += 1; continue
                }
                toks.append(.name(word)); i = j; continue
            }
            switch c {
            case "(": toks.append(.lparen)
            case ")": toks.append(.rparen)
            case ",": toks.append(.comma)
            case "%": toks.append(.percent)
            default:
                if i + 1 < chars.count, ["<=", ">=", "==", "!="].contains(String(chars[i...i + 1])) {
                    toks.append(.op(String(chars[i...i + 1]))); i += 2; continue
                }
                toks.append("+-*/^<>".contains(c) ? .op(String(c)) : .raw(String(c)))
            }
            i += 1
        }

        // x / X between two values is a times sign.
        func startsOperand(_ t: Tok?) -> Bool {
            switch t { case .num?, .lparen?, .name?: return true; default: return false }
        }
        for k in toks.indices {
            guard case .name(let w) = toks[k], w == "x" || w == "X" else { continue }
            let prev: Tok? = k > 0 ? toks[k - 1] : nil
            let next: Tok? = k + 1 < toks.count ? toks[k + 1] : nil
            // "5 x -3": a sign after x still means times, unless x is a variable the user set.
            let signedNext: Bool = {
                guard case .op(let o)? = next, o == "-" || o == "+", k + 2 < toks.count, !names.contains(w) else { return false }
                return startsOperand(toks[k + 2])
            }()
            if endsOperand(prev), startsOperand(next) || signedNext { toks[k] = .op("*") }
        }

        // A name followed by "(" is a function call unless it's a value (2pi(3) or x(2) multiply).
        func isCall(_ k: Int) -> Bool {
            guard case .name(let w) = toks[k], k + 1 < toks.count, toks[k + 1] == .lparen else { return false }
            return !names.contains(w)
        }
        var out: [String] = []
        for k in toks.indices {
            let t = toks[k]
            if k > 0 {
                let prev = toks[k - 1]
                let prevEnds: Bool = {
                    switch prev {
                    case .num, .rparen, .percent: return true
                    case .name: return !isCall(k - 1)
                    default: return false
                    }
                }()
                let starts: Bool = {
                    switch t {
                    case .lparen, .name: return true
                    case .num: if case .num = prev { return false }; return true   // "2 3" stays an error
                    default: return false
                    }
                }()
                if prevEnds && starts { out.append("*") }
            }
            switch t {
            case .num(let s): out.append(s)
            case .name(let w):
                if !isCall(k) && !names.contains(w) {
                    if w == "ans" { throw EvalError.message("There's no previous result yet, so ans isn't available.") }
                    if w == "x" || w == "X" {
                        throw EvalError.message("“\(w)” isn't set. To multiply, put a number on both sides (5 x 3) or use × or *. To use it as a variable, set it first: \(w) = 5.")
                    }
                    throw EvalError.message("“\(w)” isn't set. Set it first, like \(w) = 5, or use × or * to multiply.")
                }
                out.append(w)
            case .op(let o): out.append(o)
            case .lparen: out.append("(")
            case .rparen: out.append(")")
            case .comma: out.append(",")
            case .percent: out.append("/ 100")
            case .raw(let r): out.append(r)
            }
        }
        return out.joined(separator: " ")
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
