import Foundation

public enum EvalError: Error, LocalizedError, Equatable {
    case message(String)
    public var errorDescription: String? {
        switch self { case .message(let m): return m }
    }
}

public enum Value: Equatable {
    case number(Double)
    case series([Double])

    func num(_ ctx: String) throws -> Double {
        if case .number(let d) = self { return d }
        throw EvalError.message("\(ctx) needs a single number, not a list.")
    }

    func list(_ ctx: String) throws -> [Double] {
        switch self {
        case .series(let s): return s
        case .number(let d): return [d]
        }
    }
}

/// Expression AST for the catalog formula language:
/// numbers, variables, + − × ÷ ^, comparisons, unary minus, and function calls.
/// Arithmetic on lists is element-wise; `if(c, a, b)` evaluates lazily.
indirect enum Node {
    case num(Double)
    case variable(String)
    case unary(Character, Node)
    case binary(String, Node, Node)
    case call(String, [Node])
}

// MARK: - Lexer & parser

private enum Token: Equatable {
    case num(Double), ident(String), op(String), lparen, rparen, comma, end
}

private func tokenize(_ s: String) throws -> [Token] {
    var out: [Token] = []
    let chars = Array(s)
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
            guard let d = Double(String(chars[i..<j])) else { throw EvalError.message("Bad number in formula.") }
            out.append(.num(d)); i = j; continue
        }
        if c.isLetter || c == "_" {
            var j = i
            while j < chars.count && (chars[j].isLetter || chars[j].isNumber || chars[j] == "_") { j += 1 }
            out.append(.ident(String(chars[i..<j]))); i = j; continue
        }
        if c == "(" { out.append(.lparen); i += 1; continue }
        if c == ")" { out.append(.rparen); i += 1; continue }
        if c == "," { out.append(.comma); i += 1; continue }
        if i + 1 < chars.count {
            let two = String(chars[i...i + 1])
            if ["<=", ">=", "==", "!="].contains(two) { out.append(.op(two)); i += 2; continue }
        }
        if "+-*/^<>".contains(c) { out.append(.op(String(c))); i += 1; continue }
        throw EvalError.message("Unexpected character “\(c)” in formula.")
    }
    out.append(.end)
    return out
}

private struct Parser {
    var tokens: [Token]
    var pos = 0
    var peek: Token { tokens[pos] }
    mutating func next() -> Token { defer { pos += 1 }; return tokens[pos] }

    mutating func expect(_ t: Token) throws {
        guard next() == t else { throw EvalError.message("Malformed formula.") }
    }

    // comparison < additive < multiplicative < unary < power (right-assoc)
    mutating func comparison() throws -> Node {
        var lhs = try additive()
        while case .op(let o) = peek, ["<", ">", "<=", ">=", "==", "!="].contains(o) {
            _ = next(); lhs = .binary(o, lhs, try additive())
        }
        return lhs
    }

    mutating func additive() throws -> Node {
        var lhs = try multiplicative()
        while case .op(let o) = peek, o == "+" || o == "-" {
            _ = next(); lhs = .binary(o, lhs, try multiplicative())
        }
        return lhs
    }

    mutating func multiplicative() throws -> Node {
        var lhs = try unary()
        while case .op(let o) = peek, o == "*" || o == "/" {
            _ = next(); lhs = .binary(o, lhs, try unary())
        }
        return lhs
    }

    mutating func unary() throws -> Node {
        if case .op(let o) = peek, o == "-" || o == "+" {
            _ = next()
            let operand = try unary()
            return o == "-" ? .unary("-", operand) : operand
        }
        return try power()
    }

    mutating func power() throws -> Node {
        let base = try primary()
        if case .op("^") = peek {
            _ = next()
            return .binary("^", base, try unary())
        }
        return base
    }

    mutating func primary() throws -> Node {
        switch next() {
        case .num(let d): return .num(d)
        case .ident(let name):
            if peek == .lparen {
                _ = next()
                var args: [Node] = []
                if peek != .rparen {
                    args.append(try comparison())
                    while peek == .comma { _ = next(); args.append(try comparison()) }
                }
                try expect(.rparen)
                return .call(name.lowercased(), args)
            }
            return .variable(name)
        case .lparen:
            let e = try comparison()
            try expect(.rparen)
            return e
        default:
            throw EvalError.message("Malformed formula.")
        }
    }
}

public struct Expression {
    let root: Node
    public let source: String

    public init(_ source: String) throws {
        self.source = source
        var p = Parser(tokens: try tokenize(source))
        root = try p.comparison()
        guard p.peek == .end else { throw EvalError.message("Malformed formula: \(source)") }
    }

    public func evaluate(_ scope: [String: Value], tax: TaxTable) throws -> Value {
        try Evaluator(scope: scope, tax: tax).eval(root)
    }

    public func number(_ scope: [String: Value], tax: TaxTable) throws -> Double {
        try evaluate(scope, tax: tax).num("Result")
    }
}

// MARK: - Evaluator

private struct Evaluator {
    let scope: [String: Value]
    let tax: TaxTable

    func eval(_ n: Node) throws -> Value {
        switch n {
        case .num(let d): return .number(d)
        case .variable(let name):
            guard let v = scope[name] else { throw EvalError.message("Unknown value “\(name)”.") }
            return v
        case .unary(_, let a):
            return try map(try eval(a)) { -$0 }
        case .binary(let op, let a, let b):
            return try binary(op, try eval(a), try eval(b))
        case .call(let name, let args):
            return try call(name, args)
        }
    }

    func map(_ v: Value, _ f: (Double) -> Double) throws -> Value {
        switch v {
        case .number(let d): return .number(f(d))
        case .series(let s): return .series(s.map(f))
        }
    }

    func binary(_ op: String, _ a: Value, _ b: Value) throws -> Value {
        let f: (Double, Double) -> Double
        switch op {
        case "+": f = { $0 + $1 }
        case "-": f = { $0 - $1 }
        case "*": f = { $0 * $1 }
        case "/": f = { $0 / $1 }
        case "^": f = { pow($0, $1) }
        case "<": f = { $0 < $1 ? 1 : 0 }
        case ">": f = { $0 > $1 ? 1 : 0 }
        case "<=": f = { $0 <= $1 ? 1 : 0 }
        case ">=": f = { $0 >= $1 ? 1 : 0 }
        case "==": f = { $0 == $1 ? 1 : 0 }
        case "!=": f = { $0 != $1 ? 1 : 0 }
        default: throw EvalError.message("Unknown operator \(op).")
        }
        switch (a, b) {
        case (.number(let x), .number(let y)): return .number(f(x, y))
        case (.series(let xs), .number(let y)): return .series(xs.map { f($0, y) })
        case (.number(let x), .series(let ys)): return .series(ys.map { f(x, $0) })
        case (.series(let xs), .series(let ys)):
            guard xs.count == ys.count else { throw EvalError.message("Lists must be the same length.") }
            return .series(zip(xs, ys).map(f))
        }
    }

    func call(_ name: String, _ argNodes: [Node]) throws -> Value {
        if name == "if" {
            guard argNodes.count == 3 else { throw EvalError.message("if() takes three arguments.") }
            return try eval(argNodes[0]).num("if") != 0 ? eval(argNodes[1]) : eval(argNodes[2])
        }
        let args = try argNodes.map { try eval($0) }
        func need(_ k: Int) throws {
            guard args.count == k else { throw EvalError.message("\(name)() takes \(k) argument\(k == 1 ? "" : "s").") }
        }
        func n(_ i: Int) throws -> Double { try args[i].num(name) }
        func s(_ i: Int) throws -> [Double] { try args[i].list(name) }

        switch name {
        // finance
        case "fv": try need(4); return .number(Finance.fv(try n(0), try n(1), try n(2), try n(3)))
        case "pv": try need(3); return .number(Finance.pv(try n(0), try n(1), try n(2)))
        case "pmt": try need(3); return .number(Finance.pmt(try n(0), try n(1), try n(2)))
        case "nper": try need(4); return .number(Finance.nper(try n(0), try n(1), try n(2), try n(3)))
        case "rate": try need(3); return .number(Finance.rate(try n(0), try n(1), try n(2)))
        case "npv": try need(2); return .number(Finance.npv(try n(0), try s(1)))
        case "irr": try need(1); return .number(try Finance.irr(try s(0)))
        case "bondprice": try need(5); return .number(Finance.bondPrice(try n(0), try n(1), try n(2), try n(3), try n(4)))
        case "bondytm": try need(5); return .number(Finance.bondYTM(try n(0), try n(1), try n(2), try n(3), try n(4)))
        case "macdur": try need(5); return .number(Finance.macaulayDuration(try n(0), try n(1), try n(2), try n(3), try n(4)))
        case "bondconvexity": try need(5); return .number(Finance.convexity(try n(0), try n(1), try n(2), try n(3), try n(4)))
        case "nan": try need(0); return .number(.nan)
        case "pi": try need(0); return .number(Double.pi)
        // statistics
        case "median": try need(1); return .number(try Stats.median(try s(0)))
        case "var": try need(1); return .number(try Stats.variance(try s(0)))
        case "sd": try need(1); return .number(try Stats.sd(try s(0)))
        case "cov": try need(2); return .number(try Stats.covariance(try s(0), try s(1)))
        case "corr": try need(2); return .number(try Stats.correlation(try s(0), try s(1)))
        case "dw": try need(1); return .number(try Stats.durbinWatson(try s(0)))
        case "topsum": try need(2); return .number(Stats.topSum(try s(0), try n(1)))
        case "normcdf": try need(1); return try map(args[0]) { Stats.normCDF($0) }
        case "norminv": try need(1); return .number(try Stats.normInv(try n(0)))
        case "tcdf": try need(2); return .number(try Stats.tCDF(try n(0), try n(1)))
        case "tinv": try need(2); return .number(try Stats.tInv(try n(0), try n(1)))
        case "fcdf": try need(3); return .number(try Stats.fCDF(try n(0), try n(1), try n(2)))
        case "binompmf": try need(3); return .number(Stats.binomPMF(try n(0), try n(1), try n(2)))
        case "binomcdf": try need(3); return .number(Stats.binomCDF(try n(0), try n(1), try n(2)))
        // tax table
        case "incometax": try need(2); return .number(try tax.incomeTax(try n(0), try n(1)))
        case "margrate": try need(2); return .number(try tax.marginalRate(try n(0), try n(1)))
        case "bracketroom": try need(2); return .number(try tax.bracketRoom(try n(0), try n(1)))
        case "stddeduction": try need(1); return .number(try tax.standardDeduction(try n(0)))
        case "ltcgtax": try need(3); return .number(try tax.ltcgTax(try n(0), try n(1), try n(2)))
        case "niitthreshold": try need(1); return .number(try tax.niitThreshold(try n(0)))
        case "niitrate": try need(0); return .number(tax.niitRate)
        case "rmdfactor": try need(1); return .number(try tax.rmdFactor(try n(0)))
        case "limit401k": try need(1); return .number(tax.limit401k(try n(0)))
        case "limitira": try need(1); return .number(tax.limitIRA(try n(0)))
        case "giftexclusion": try need(0); return .number(tax.giftAnnualExclusion)
        case "estateexemption": try need(0); return .number(tax.estateExemption)
        case "estaterate": try need(0); return .number(tax.estateTopRate)
        // math
        case "min":
            guard !args.isEmpty else { throw EvalError.message("min() needs arguments.") }
            return .number(try args.flatMap { try $0.list(name) }.min()!)
        case "max":
            guard !args.isEmpty else { throw EvalError.message("max() needs arguments.") }
            return .number(try args.flatMap { try $0.list(name) }.max()!)
        case "abs": try need(1); return try map(args[0]) { Swift.abs($0) }
        case "sqrt": try need(1); return try map(args[0]) { $0.squareRoot() }
        case "ln": try need(1); return try map(args[0]) { Foundation.log($0) }
        case "exp": try need(1); return try map(args[0]) { Foundation.exp($0) }
        case "floor": try need(1); return try map(args[0]) { $0.rounded(.down) }
        case "ceil": try need(1); return try map(args[0]) { $0.rounded(.up) }
        case "sum": try need(1); return .number(try s(0).reduce(0, +))
        case "count": try need(1); return .number(Double(try s(0).count))
        case "avg":
            try need(1)
            let l = try s(0)
            guard !l.isEmpty else { throw EvalError.message("avg() of an empty list.") }
            return .number(l.reduce(0, +) / Double(l.count))
        case "sumproduct":
            try need(2)
            let a = try s(0), b = try s(1)
            guard a.count == b.count else { throw EvalError.message("Lists must be the same length.") }
            return .number(zip(a, b).map(*).reduce(0, +))
        default:
            throw EvalError.message("Unknown function \(name)().")
        }
    }
}
