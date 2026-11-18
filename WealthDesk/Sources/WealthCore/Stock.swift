import Foundation

// Stock research: the numbers behind the one-ticker screen.
// Same rules as tools/stock_reference.py (the reference, which spells them out) and web/stock.js;
// web/stock-check.mjs compares all three on saved public data (wdparity stock <fixture>).

public enum StockMath {
    public static let concepts: [String: [String]] = [
        "revenue": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
                    "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
        "grossProfit": ["GrossProfit"],
        "opIncome": ["OperatingIncomeLoss"],
        "netIncome": ["NetIncomeLoss"],
        "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"],
        "shares": ["WeightedAverageNumberOfDilutedSharesOutstanding"],
        "ocf": ["NetCashProvidedByUsedInOperatingActivities"],
        "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
        "daTotal": ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"],
        "daDepreciation": ["Depreciation"],
        "daAmortization": ["AmortizationOfIntangibleAssets"],
        "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
        "debtTotal": ["LongTermDebt", "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"],
        "debtNoncurrent": ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"],
        "debtCurrent": ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
        "equity": ["StockholdersEquity"],
        "dps": ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
    ]
    static let unit: [String: String] = ["eps": "USD/shares", "dps": "USD/shares", "shares": "shares"]
    static let perShare: Set<String> = ["eps", "dps"]
    static let flows = ["revenue", "grossProfit", "opIncome", "netIncome", "eps", "shares", "ocf", "capex", "dps"]
    static let composite: [String: (String, String, String)] = ["da": ("daTotal", "daDepreciation", "daAmortization"),
                                                                 "debt": ("debtTotal", "debtNoncurrent", "debtCurrent")]
    static let staleDays = 200
    static let filingForms: Set<String> = ["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "20-F", "40-F", "6-K", "DEF 14A", "S-1"]
    public static let periods: [(String, Int, Int)] = [("1M", 1, 0), ("3M", 3, 0), ("6M", 6, 0), ("YTD", 0, 0),
                                                       ("1Y", 0, 1), ("3Y", 0, 3), ("5Y", 0, 5), ("10Y", 0, 10)]

    // Calendar days since 1970-01-01 (proleptic Gregorian).
    public static func days(_ y: Int, _ m: Int, _ d: Int) -> Int {
        let y2 = m <= 2 ? y - 1 : y
        let era = (y2 >= 0 ? y2 : y2 - 399) / 400
        let yoe = y2 - era * 400
        let doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }
    public static func ymd(_ z0: Int) -> (Int, Int, Int) {
        let z = z0 + 719468
        let era = (z >= 0 ? z : z - 146096) / 146097
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (m <= 2 ? 1 : 0), m, d)
    }
    public static func dnum(_ s: String) -> Int {
        let p = s.prefix(10).split(separator: "-").compactMap { Int($0) }
        return days(p[0], p[1], p[2])
    }
    public static func dstr(_ n: Int?) -> String? {
        guard let n else { return nil }
        let (y, m, d) = ymd(n)
        return String(format: "%04d-%02d-%02d", y, m, d)
    }
    static func tsDay(_ ts: Double, _ off: Double) -> Int { Int(((ts + off) / 86400).rounded(.down)) }
    static func shift(_ day: Int, months: Int, years: Int) -> Int {
        let (y0, m0, d0) = ymd(day)
        let m = y0 * 12 + (m0 - 1) - months - 12 * years
        let y = Int((Double(m) / 12).rounded(.down)), mo = m - y * 12 + 1
        let last = days(mo == 12 ? y + 1 : y, mo == 12 ? 1 : mo + 1, 1) - days(y, mo, 1)
        return days(y, mo, min(d0, last))
    }
}

/// One price bar: day number, split-adjusted close, adjusted close (dividends reinvested).
public struct Bar { public let day: Int; public let close: Double; public let adj: Double }

/// Trimmed Yahoo chart data (the same shape the web version's lookup service returns).
public struct ChartData {
    public var meta: [String: Any]
    public var timestamp: [Double]
    public var close: [Double?]
    public var adjclose: [Double?]?
    public var dividends: [(Double, Double)]
    public var splits: [(Double, Double, Double)]

    static func nums(_ a: Any?) -> [Double?] { (a as? [Any] ?? []).map { ($0 as? NSNumber)?.doubleValue } }

    /// From either a trimmed chart ({meta, timestamp, close, ...}) or Yahoo's raw response.
    public init(json: Any) throws {
        guard var o = json as? [String: Any] else { throw EvalError.message("No data for this symbol.") }
        if let chart = o["chart"] as? [String: Any] {
            guard let r = (chart["result"] as? [Any])?.first as? [String: Any] else {
                throw EvalError.message(((chart["error"] as? [String: Any])?["description"] as? String) ?? "No data for this symbol.")
            }
            let ind = r["indicators"] as? [String: Any] ?? [:]
            let q = (ind["quote"] as? [Any])?.first as? [String: Any] ?? [:]
            let ev = r["events"] as? [String: Any] ?? [:]
            o = ["meta": r["meta"] ?? [:], "timestamp": r["timestamp"] ?? [], "close": q["close"] ?? []]
            if let a = ((ind["adjclose"] as? [Any])?.first as? [String: Any])?["adjclose"] { o["adjclose"] = a }
            o["dividends"] = (ev["dividends"] as? [String: Any] ?? [:]).values.compactMap { $0 as? [String: Any] }
                .map { [$0["date"] ?? 0, $0["amount"] ?? 0] }
            o["splits"] = (ev["splits"] as? [String: Any] ?? [:]).values.compactMap { $0 as? [String: Any] }
                .map { [$0["date"] ?? 0, $0["numerator"] ?? 1, $0["denominator"] ?? 1] }
        }
        meta = o["meta"] as? [String: Any] ?? [:]
        timestamp = Self.nums(o["timestamp"]).map { $0 ?? 0 }
        close = Self.nums(o["close"])
        adjclose = o["adjclose"] == nil ? nil : Self.nums(o["adjclose"])
        dividends = (o["dividends"] as? [Any] ?? []).map { Self.nums($0) }.map { ($0[0] ?? 0, $0[1] ?? 0) }.sorted { $0.0 < $1.0 }
        splits = (o["splits"] as? [Any] ?? []).map { Self.nums($0) }.map { ($0[0] ?? 0, $0[1] ?? 1, $0[2] ?? 1) }.sorted { $0.0 < $1.0 }
    }
    func m(_ k: String) -> Double? { (meta[k] as? NSNumber)?.doubleValue }
    func s(_ k: String) -> String? { meta[k] as? String }
    var offset: Double { m("gmtoffset") ?? 0 }

    func series() -> [Bar] {
        let adj = adjclose ?? close
        var out: [Bar] = []
        for (i, t) in timestamp.enumerated() {
            guard i < close.count, i < adj.count, let c = close[i], let a = adj[i] else { continue }
            let day = StockMath.tsDay(t, offset)
            if let l = out.last, l.day == day { out[out.count - 1] = Bar(day: day, close: c, adj: a) } else { out.append(Bar(day: day, close: c, adj: a)) }
        }
        return out
    }
}

public struct StockInput {
    public var daily: ChartData
    public var intraday: ChartData?
    public var bench: ChartData
    public var facts: [String: Any]?
    public var subs: [String: Any]?
    public init(daily: ChartData, intraday: ChartData?, bench: ChartData, facts: [String: Any]?, subs: [String: Any]?) {
        self.daily = daily; self.intraday = intraday; self.bench = bench; self.facts = facts; self.subs = subs
    }
    /// From a fixture / lookup-service response: {daily, intraday, bench, facts, subs}.
    public init(json o: [String: Any]) throws {
        daily = try ChartData(json: o["daily"] as Any)
        intraday = (o["intraday"] is NSNull || o["intraday"] == nil) ? nil : try? ChartData(json: o["intraday"]!)
        bench = try ChartData(json: o["bench"] as Any)
        facts = o["facts"] as? [String: Any]
        subs = o["subs"] as? [String: Any]
    }
}

public struct AnnualRow {
    public var end: String
    public var v: [String: Double?] = [:]
    public subscript(_ k: String) -> Double? { v[k] ?? nil }
}
public struct PeriodReturn { public let key: String; public let stock: Double?; public let bench: Double? }
public struct Filing: Identifiable { public var id: String { url }; public let date, form, description, url: String }

public struct StockReport {
    public var symbol: String
    public var name: String?
    public var currency: String
    public var exchange: String?
    public var quote: [String: Double?]
    public var lastDay: String
    public var returns: [PeriodReturn]
    public var risk: [String: Double?]
    public var betaMonths: Int
    public var ddDays: [String: String?]
    public var dividends: [String: Double?]
    public var annual: [AnnualRow]
    public var ttm: [String: Double?]
    public var ttmThrough: [String: String?]
    public var balance: [String: Double?]
    public var balanceAsOf: [String: String?]
    public var valuation: [String: Double?]
    public var medians: [String: Double?]
    public var growth: [String: Double?]
    public var filings: [Filing]
    public var company: (cik: Int, name: String, sic: String?)?
    public var bars: [Bar]
    public var benchBars: [Bar]
    public var intraday: [(Double, Double)]
    public var hasFacts: Bool
}

private struct Entry { let start: Int?; let end: Int; let val: Double; let filed: Int; let i: Int }

private final class Facts {
    let g: [String: Any], dei: [String: Any], splits: [(Int, Double, Double)]
    var cache: [String: [Entry]] = [:]
    init(_ facts: [String: Any]?, splits: [(Int, Double, Double)]) {
        let f = facts?["facts"] as? [String: Any] ?? [:]
        g = f["us-gaap"] as? [String: Any] ?? [:]
        dei = f["dei"] as? [String: Any] ?? [:]
        self.splits = splits
    }
    func factor(_ filed: Int) -> Double { splits.reduce(1.0) { $1.0 > filed ? $0 * $1.1 / $1.2 : $0 } }
    static func list(_ grp: [String: Any], _ concept: String, _ unit: String) -> [Entry] {
        let es = ((grp[concept] as? [String: Any])?["units"] as? [String: Any])?[unit] as? [Any] ?? []
        return es.enumerated().compactMap { i, x in
            guard let e = x as? [String: Any], let end = e["end"] as? String, let filed = e["filed"] as? String,
                  let val = (e["val"] as? NSNumber)?.doubleValue else { return nil }
            return Entry(start: (e["start"] as? String).map(StockMath.dnum), end: StockMath.dnum(end), val: val, filed: StockMath.dnum(filed), i: i)
        }
    }
    func entries(_ concept: String, _ unit: String) -> [Entry] {
        let k = concept + "|" + unit
        if let c = cache[k] { return c }
        let v = Self.list(g, concept, unit)
        cache[k] = v
        return v
    }
    func adjust(_ key: String, _ val: Double, _ filed: Int) -> Double {
        if StockMath.perShare.contains(key) { return val / factor(filed) }
        if key == "shares" { return val * factor(filed) }
        return val
    }
    func best(_ c: [Entry], _ target: Int) -> Entry {
        c.max { a, b in
            if a.filed != b.filed { return a.filed < b.filed }
            let da = -abs(a.end - target), db = -abs(b.end - target)
            if da != db { return da < db }
            return a.i < b.i
        }!
    }
    static func annual(_ e: Entry) -> Bool { if let s = e.start { return e.end - s >= 340 && e.end - s <= 390 }; return false }
    func valueAt(_ key: String, _ end: Int, flow: Bool) -> Double? {
        let unit = StockMath.unit[key] ?? "USD"
        for c in StockMath.concepts[key]! {
            let cands = entries(c, unit).filter { abs($0.end - end) <= 7 && (flow ? Self.annual($0) : $0.start == nil) }
            if !cands.isEmpty { let e = best(cands, end); return adjust(key, e.val, e.filed) }
        }
        return nil
    }
    func compositeAt(_ key: String, _ end: Int, flow: Bool) -> Double? {
        let (t, p1, p2) = StockMath.composite[key]!
        if let v = valueAt(t, end, flow: flow) { return v }
        let a = valueAt(p1, end, flow: flow), c = valueAt(p2, end, flow: flow)
        if a == nil && c == nil { return nil }
        return (a ?? 0) + (c ?? 0)
    }
    func fiscalEnds() -> [Int] {
        var ends = Set<Int>()
        for key in ["revenue", "netIncome"] { for c in StockMath.concepts[key]! { for e in entries(c, "USD") where Self.annual(e) { ends.insert(e.end) } } }
        var kept: [Int] = []
        for d in ends.sorted(by: >) where kept.allSatisfy({ abs(d - $0) > 7 }) { kept.append(d) }
        return Array(kept.prefix(10)).sorted()
    }
    func ttm(_ key: String, _ fyEnd: Int) -> (Double?, Int?) {
        let unit = StockMath.unit[key] ?? "USD"
        for c in StockMath.concepts[key]! {
            let es = entries(c, unit)
            let fy = es.filter { abs($0.end - fyEnd) <= 7 && Self.annual($0) }
            if fy.isEmpty { continue }
            let f = best(fy, fyEnd), fv = adjust(key, f.val, f.filed)
            let ytd = es.filter { e in guard let s = e.start else { return false }; return s - fyEnd > 0 && s - fyEnd <= 10 && e.end - s < 340 }
            if let qEnd = ytd.map(\.end).max() {
                let cur = best(ytd.filter { $0.end == qEnd }, qEnd), dur = cur.end - cur.start!
                let pr = es.filter { e in guard let s = e.start else { return false }; return abs(e.end - (qEnd - 365)) <= 10 && abs((e.end - s) - dur) <= 10 }
                if !pr.isEmpty {
                    let p = best(pr, qEnd - 365)
                    return (fv + adjust(key, cur.val, cur.filed) - adjust(key, p.val, p.filed), qEnd)
                }
            }
            return (fv, f.end)
        }
        return (nil, nil)
    }
    func compositeTTM(_ key: String, _ fyEnd: Int) -> (Double?, Int?) {
        let (t, p1, p2) = StockMath.composite[key]!
        let tv = ttm(t, fyEnd)
        if tv.0 != nil { return tv }
        let a = ttm(p1, fyEnd), c = ttm(p2, fyEnd)
        if a.0 == nil && c.0 == nil { return (nil, nil) }
        return ((a.0 ?? 0) + (c.0 ?? 0), a.0 != nil ? a.1 : c.1)
    }
    func latestInstant(_ keys: [String]) -> Int? {
        var m: Int?
        for k in keys { for c in StockMath.concepts[k]! { for e in entries(c, StockMath.unit[k] ?? "USD") where e.start == nil { if m == nil || e.end > m! { m = e.end } } } }
        return m
    }
    func sharesOut() -> (Double?, Int?) {
        let es = Self.list(dei, "EntityCommonStockSharesOutstanding", "shares")
        guard let b = es.max(by: { ($0.end, $0.filed, $0.i) < ($1.end, $1.filed, $1.i) }) else { return (nil, nil) }
        return (b.val * factor(b.filed), b.end)
    }
}

extension StockMath {
    static func atOrBefore(_ s: [Bar], _ day: Int) -> Int? {
        var lo = 0, hi = s.count - 1, k: Int?
        while lo <= hi { let mid = (lo + hi) / 2; if s[mid].day <= day { k = mid; lo = mid + 1 } else { hi = mid - 1 } }
        return k
    }
    static func periodReturns(_ s: [Bar]) -> [String: Double?] {
        var out: [String: Double?] = [:]
        guard let last = s.last else { for p in periods { out[p.0] = .some(nil) }; return out }
        for (key, mo, yr) in periods {
            let target = key == "YTD" ? days(ymd(last.day).0 - 1, 12, 31) : shift(last.day, months: mo, years: yr)
            guard let k = atOrBefore(s, target) else { out[key] = .some(nil); continue }
            var r = last.adj / s[k].adj - 1
            if yr >= 3 { r = pow(1 + r, 365.25 / Double(last.day - s[k].day)) - 1 }
            out[key] = r
        }
        return out
    }
    static func mean(_ v: [Double]) -> Double { v.reduce(0, +) / Double(v.count) }
    static func volatility(_ s: [Bar]) -> Double? {
        guard s.count >= 2 else { return nil }
        let start = s.last!.day - 365
        var r: [Double] = []
        for i in 1..<s.count where s[i].day > start { r.append(log(s[i].adj / s[i - 1].adj)) }
        guard r.count >= 20 else { return nil }
        let m = mean(r)
        return (r.reduce(0) { $0 + ($1 - m) * ($1 - m) } / Double(r.count - 1)).squareRoot() * 252.0.squareRoot()
    }
    static func monthEnds(_ s: [Bar]) -> [Int: Double] {
        var out: [Int: Double] = [:]
        guard let last = s.last else { return out }
        let (cy, cm, _) = ymd(last.day), cur = cy * 12 + cm - 1
        for b in s { let (y, m, _) = ymd(b.day); let k = y * 12 + m - 1; if k < cur { out[k] = b.adj } }
        return out
    }
    static func beta(_ s: [Bar], _ b: [Bar]) -> (Double?, Int) {
        let ms = monthEnds(s), mb = monthEnds(b)
        let keys = Array(ms.keys.filter { mb[$0] != nil && ms[$0 - 1] != nil && mb[$0 - 1] != nil }.sorted().suffix(60))
        guard keys.count >= 24 else { return (nil, keys.count) }
        let x = keys.map { ms[$0]! / ms[$0 - 1]! - 1 }, y = keys.map { mb[$0]! / mb[$0 - 1]! - 1 }
        let mx = mean(x), my = mean(y)
        let v = y.reduce(0) { $0 + ($1 - my) * ($1 - my) }
        var c = 0.0
        for i in 0..<x.count { c += (x[i] - mx) * (y[i] - my) }
        return (c / v, keys.count)
    }
    static func median(_ v: [Double?]) -> Double? {
        let x = v.compactMap { $0 }.sorted()
        guard x.count >= 3 else { return nil }
        let n = x.count
        return n % 2 == 1 ? x[(n - 1) / 2] : (x[n / 2 - 1] + x[n / 2]) / 2
    }
    static func div(_ a: Double?, _ b: Double?) -> Double? { guard let a, let b, b != 0 else { return nil }; return a / b }
    static func posDiv(_ a: Double?, _ b: Double?) -> Double? { guard let a, let b, b > 0 else { return nil }; return a / b }

    public static func analyze(_ fx: StockInput) throws -> StockReport {
        let daily = fx.daily, s = daily.series(), b = fx.bench.series(), off = daily.offset
        guard let lastBar = s.last else { throw EvalError.message("No price history for this symbol.") }
        let price = fx.intraday?.m("regularMarketPrice") ?? daily.m("regularMarketPrice")
        var prev = fx.intraday?.m("chartPreviousClose")
        if prev == nil { prev = s.count > 1 ? s[s.count - 2].close : nil }
        let rs = periodReturns(s), rb = periodReturns(b)
        let (bt, months) = beta(s, b)
        let divs = daily.dividends.map { (tsDay($0.0, off), $0.1) }
        let last = lastBar.day
        var ttmDiv = 0.0
        for (d, a) in divs where d > last - 365 { ttmDiv += a }
        let yr = ymd(last).0
        var byYear: [Int: Double] = [:]
        for (d, a) in divs { byYear[ymd(d).0, default: 0] += a }
        let a1 = byYear[yr - 1] ?? 0, a6 = byYear[yr - 6] ?? 0
        let growth5: Double? = a1 > 0 && a6 > 0 ? pow(a1 / a6, 0.2) - 1 : nil

        let F = Facts(fx.facts, splits: daily.splits.map { (tsDay($0.0, off), $0.1, $0.2) })
        let ends = F.fiscalEnds()
        var rows: [AnnualRow] = ends.map { e in
            var r = AnnualRow(end: dstr(e)!)
            for k in flows { r.v[k] = .some(F.valueAt(k, e, flow: true)) }
            r.v["cash"] = .some(F.valueAt("cash", e, flow: false))
            r.v["equity"] = .some(F.valueAt("equity", e, flow: false))
            r.v["debt"] = .some(F.compositeAt("debt", e, flow: false))
            r.v["da"] = .some(F.compositeAt("da", e, flow: true))
            r.v["fcf"] = .some(r["ocf"] == nil || r["capex"] == nil ? nil : r["ocf"]! - r["capex"]!)
            for (m, k) in [("grossMargin", "grossProfit"), ("opMargin", "opIncome"), ("netMargin", "netIncome"), ("fcfMargin", "fcf")] {
                r.v[m] = .some(posDiv(r[k], r["revenue"]))
            }
            let k = atOrBefore(s, e)
            let px: Double? = k != nil && e >= s[0].day ? s[k!].close : nil
            r.v["price"] = .some(px)
            let mcap: Double? = px == nil || r["shares"] == nil ? nil : px! * r["shares"]!
            r.v["pe"] = .some(posDiv(px, r["eps"]))
            r.v["ps"] = .some(posDiv(mcap, r["revenue"]))
            r.v["fcfYield"] = .some(div(r["fcf"], mcap))
            let ebitda: Double? = r["opIncome"] == nil || r["da"] == nil ? nil : r["opIncome"]! + r["da"]!
            let ev: Double? = mcap.map { $0 + (r["debt"] ?? 0) - (r["cash"] ?? 0) }
            r.v["evEbitda"] = .some(posDiv(ev, ebitda))
            return r
        }
        for i in rows.indices {
            let p: AnnualRow? = i > 0 ? rows[i - 1] : nil
            let rv = rows[i]["revenue"], ev = rows[i]["eps"]
            rows[i].v["revGrowth"] = .some(p == nil || p!["revenue"] == nil || rv == nil || p!["revenue"]! <= 0 ? nil : rv! / p!["revenue"]! - 1)
            rows[i].v["epsGrowth"] = .some(p == nil || p!["eps"] == nil || ev == nil || p!["eps"]! <= 0 ? nil : ev! / p!["eps"]! - 1)
        }

        var ttm: [String: Double?] = [:], through: [String: String?] = [:]
        if let fyEnd = ends.last {
            for k in ["revenue", "grossProfit", "opIncome", "netIncome", "eps", "ocf", "capex", "da"] {
                let (v, t) = composite[k] != nil ? F.compositeTTM(k, fyEnd) : F.ttm(k, fyEnd)
                ttm[k] = .some(v)
                if k == "revenue" || k == "eps" { through[k] = .some(dstr(t)) }
            }
        }
        func T(_ k: String) -> Double? { ttm[k] ?? nil }
        ttm["fcf"] = .some(T("ocf") == nil || T("capex") == nil ? nil : T("ocf")! - T("capex")!)
        ttm["ebitda"] = .some(T("opIncome") == nil || T("da") == nil ? nil : T("opIncome")! + T("da")!)

        var bal: [String: Double?] = [:], asOf: [String: String?] = [:]
        var ref: Int?
        if let l = ends.last { ref = ([l] + ["revenue", "eps"].compactMap { (through[$0] ?? nil).map(dnum) }).max() }
        for (key, parts) in [("cash", ["cash"]), ("equity", ["equity"]), ("debt", ["debtTotal", "debtNoncurrent", "debtCurrent"])] {
            var e = F.latestInstant(parts)
            if let x = e, let r = ref, x < r - staleDays { e = nil }
            bal[key] = .some(e == nil ? nil : (composite[key] != nil ? F.compositeAt(key, e!, flow: false) : F.valueAt(key, e!, flow: false)))
            asOf[key] = .some(dstr(e))
        }
        var (so, soEnd) = F.sharesOut()
        if so == nil, let l = rows.last { so = l["shares"]; soEnd = dnum(l.end) }
        bal["sharesOut"] = .some(so); asOf["shares"] = .some(dstr(soEnd))
        func B(_ k: String) -> Double? { bal[k] ?? nil }

        let mcap: Double? = price == nil || so == nil ? nil : price! * so!
        let ev: Double? = mcap.map { $0 + (B("debt") ?? 0) - (B("cash") ?? 0) }
        let valuation: [String: Double?] = [
            "marketCap": mcap, "ev": ev, "pe": posDiv(price, T("eps")), "ps": posDiv(mcap, T("revenue")), "pb": posDiv(mcap, B("equity")),
            "evEbitda": posDiv(ev, T("ebitda")), "fcfYield": div(T("fcf"), mcap), "divYield": div(ttmDiv, price)]
        var medians: [String: Double?] = [:]
        for k in ["pe", "ps", "evEbitda", "fcfYield"] { medians[k] = .some(median(rows.map { $0[k] })) }

        var growth: [String: Double?] = ["revenueCAGR": nil, "epsCAGR": nil, "years": nil]
        if rows.count >= 2, let f = rows.first, let l = rows.last {
            let yrs = Double(dnum(l.end) - dnum(f.end)) / 365.25
            growth["years"] = yrs
            if let a = f["revenue"], let z = l["revenue"], a > 0, z > 0 { growth["revenueCAGR"] = pow(z / a, 1 / yrs) - 1 }
            if let a = f["eps"], let z = l["eps"], a > 0, z > 0 { growth["epsCAGR"] = pow(z / a, 1 / yrs) - 1 }
        }

        var filings: [Filing] = []
        var company: (Int, String, String?)?
        if let subs = fx.subs, let recent = (subs["filings"] as? [String: Any])?["recent"] as? [String: Any] {
            let cik = Int("\(subs["cik"] ?? "0")") ?? 0
            company = (cik, subs["name"] as? String ?? "", subs["sicDescription"] as? String)
            let form = recent["form"] as? [String] ?? [], fd = recent["filingDate"] as? [String] ?? []
            let accn = recent["accessionNumber"] as? [String] ?? [], doc = recent["primaryDocument"] as? [String] ?? []
            let desc = recent["primaryDocDescription"] as? [Any] ?? []
            for i in form.indices where filings.count < 15 && filingForms.contains(form[i]) {
                let d = (i < desc.count ? desc[i] as? String : nil).flatMap { $0.isEmpty ? nil : $0 } ?? form[i]
                filings.append(Filing(date: fd[i], form: form[i], description: d,
                                      url: "https://www.sec.gov/Archives/edgar/data/\(cik)/\(accn[i].replacingOccurrences(of: "-", with: ""))/\(doc[i])"))
            }
        }

        var intra: [(Double, Double)] = []
        if let i = fx.intraday { for (k, t) in i.timestamp.enumerated() where k < i.close.count { if let c = i.close[k] { intra.append((t, c)) } } }
        let dd = drawdown(s)
        return StockReport(
            symbol: daily.s("symbol") ?? "", name: daily.s("longName") ?? daily.s("shortName"),
            currency: daily.s("currency") ?? "USD", exchange: daily.s("exchangeName"),
            quote: ["price": price, "prevClose": prev, "change": prev == nil || price == nil ? nil : price! - prev!,
                    "changePct": prev == nil || prev == 0 || price == nil ? nil : price! / prev! - 1,
                    "high52": daily.m("fiftyTwoWeekHigh"), "low52": daily.m("fiftyTwoWeekLow")],
            lastDay: dstr(last)!,
            returns: periods.map { PeriodReturn(key: $0.0, stock: rs[$0.0] ?? nil, bench: rb[$0.0] ?? nil) },
            risk: ["vol1y": volatility(s), "benchVol1y": volatility(b), "beta5y": bt, "maxDD": dd.0, "currentDD": dd.1],
            betaMonths: months, ddDays: dd.2,
            dividends: ["ttm": ttmDiv, "yield": div(ttmDiv, price), "growth5": growth5],
            annual: rows, ttm: ttm, ttmThrough: through, balance: bal, balanceAsOf: asOf,
            valuation: valuation, medians: medians, growth: growth, filings: filings,
            company: company.map { (cik: $0.0, name: $0.1, sic: $0.2) },
            bars: s, benchBars: b, intraday: intra, hasFacts: fx.facts != nil)
    }

    static func drawdown(_ s: [Bar]) -> (Double, Double, [String: String?]) {
        var peak = s[0].adj, peakDay = s[0].day
        var best: (Double, Int?, Int?) = (0, nil, nil)
        for b in s {
            if b.adj > peak { peak = b.adj; peakDay = b.day }
            let dd = 1 - b.adj / peak
            if dd > best.0 { best = (dd, peakDay, b.day) }
        }
        var rec: Int?
        if let pd = best.1, let td = best.2 {
            let pk = s.first { $0.day == pd }!.adj
            rec = s.first { $0.day > td && $0.adj >= pk }?.day
        }
        let runPeak = s.map(\.adj).max()!
        return (best.0, 1 - s.last!.adj / runPeak, ["peakDay": dstr(best.1), "troughDay": dstr(best.2), "recoveryDay": dstr(rec)])
    }
}

extension StockReport {
    /// The figures the cross-check compares, in the reference's layout.
    public func checkJSON() -> [String: Any] {
        func n(_ d: Double??) -> Any { (d ?? nil).map { $0 as Any } ?? NSNull() }
        func sd(_ d: String??) -> Any { (d ?? nil).map { $0 as Any } ?? NSNull() }
        let rowKeys = Set(annual.first?.v.keys.map { $0 } ?? [])
        return [
            "symbol": symbol, "name": name as Any? ?? NSNull(),
            "quote": ["price": n(quote["price"]), "prevClose": n(quote["prevClose"]), "change": n(quote["change"]), "changePct": n(quote["changePct"]),
                      "high52": n(quote["high52"]), "low52": n(quote["low52"]), "lastDay": lastDay],
            "returns": returns.map { ["key": $0.key, "stock": n($0.stock), "bench": n($0.bench)] },
            "risk": ["vol1y": n(risk["vol1y"]), "benchVol1y": n(risk["benchVol1y"]), "beta5y": n(risk["beta5y"]), "betaMonths": betaMonths,
                     "maxDD": n(risk["maxDD"]), "peakDay": sd(ddDays["peakDay"]), "troughDay": sd(ddDays["troughDay"]),
                     "recoveryDay": sd(ddDays["recoveryDay"]), "currentDD": n(risk["currentDD"])],
            "dividends": ["ttm": n(dividends["ttm"]), "yield": n(dividends["yield"]), "growth5": n(dividends["growth5"])],
            "annual": annual.map { r -> [String: Any] in
                var o: [String: Any] = ["end": r.end]
                for k in rowKeys { o[k] = n(r.v[k]) }
                return o
            },
            "ttm": ttm.mapValues { n($0) }.merging(["revenueThrough": sd(ttmThrough["revenue"]), "epsThrough": sd(ttmThrough["eps"])].filter { _ in !ttmThrough.isEmpty }) { a, _ in a },
            "balance": ["cash": n(balance["cash"]), "cashAsOf": sd(balanceAsOf["cash"]), "equity": n(balance["equity"]), "equityAsOf": sd(balanceAsOf["equity"]),
                        "debt": n(balance["debt"]), "debtAsOf": sd(balanceAsOf["debt"]), "sharesOut": n(balance["sharesOut"]), "sharesAsOf": sd(balanceAsOf["shares"])],
            "valuation": valuation.mapValues { n($0) }.merging(["medians": medians.mapValues { n($0) }]) { a, _ in a },
            "growth": growth.mapValues { n($0) },
            "filings": filings.map { ["date": $0.date, "form": $0.form, "description": $0.description, "url": $0.url] },
        ]
    }
}
