import Foundation

/// Port of roro/data.py: FRED (keyless CSV) + Yahoo daily history, with an on-disk cache so a
/// flaky source falls back to the last good copy. Cache files use the same CSV layout as the
/// Python tool (`fred_SID.csv`, `yf_TICKER.csv`), so either engine can read them.
public struct RoRoHealth: Codable, Equatable {
    public let source: String
    public let id: String
    public let status: String
    public let last: String?
}

public enum RoRoSources {
    public static let historyStart: Day = DayMath.day(1999, 1, 1)

    public static let fredSeries = [
        "SAHMREALTIME", "ICSA", "UNRATE", "CFNAIMA3", "PERMIT", "INDPRO",
        "T10Y3M", "T10Y2Y", "NFCI", "DFF", "PCEPILFE", "WALCL", "WTREGEN", "RRPONTSYD", "DGS10",
        "BAMLH0A0HYM2", "BAMLC0A0CM", "BAA10Y",
    ]

    public static let sectors = ["XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY", "XLC", "XLRE"]

    public static let assetClasses: [(String, [String])] = [
        ("Commodities", ["DBC", "GLD"]),
        ("Currencies (USD)", ["UUP"]),
        ("Domestic Equities", ["SPY", "IWM", "QQQ"]),
        ("Cash", ["BIL", "SHV"]),
        ("Fixed Income", ["AGG", "TLT"]),
        ("International Equities", ["EFA", "EEM"]),
        ("Crypto", ["BTC-USD", "ETH-USD"]),
    ]

    /// sorted(set(...)) exactly as data.py builds YF_TICKERS.
    public static let yahooTickers: [String] = Array(Set(
        ["^GSPC", "^NYA", "RSP", "SPY", "^VIX", "^VIX3M", "^SKEW", "^MOVE", "DX-Y.NYB",
         "SPHB", "SPLV", "HYG", "IEF", "XLY", "XLP", "IWF", "IWD", "HG=F", "GC=F", "AUDJPY=X"]
        + sectors + assetClasses.flatMap(\.1)
    )).sorted()
}

/// The data accessor factor calcs use (data.Data).
public final class RoRoData {
    public let fredRawSeries: [String: TimeSeries]
    public let yahooRawSeries: [String: TimeSeries]
    public let health: [RoRoHealth]
    public let demo: Bool
    /// Business days from 1999-01-01 through the latest observation of any series.
    public let index: [Day]
    private var cacheFred: [String: [Double]] = [:]
    private var cacheYahoo: [String: [Double]] = [:]

    public init(fred: [String: TimeSeries], yahoo: [String: TimeSeries], health: [RoRoHealth], demo: Bool = false) {
        fredRawSeries = fred
        yahooRawSeries = yahoo
        self.health = health
        self.demo = demo
        let last = (Array(fred.values) + Array(yahoo.values)).compactMap(\.lastDay).max() ?? RoRoSources.historyStart
        index = DayMath.businessDays(from: RoRoSources.historyStart, through: last)
    }

    public var count: Int { index.count }

    /// D.daily(s): forward-filled onto the business-day index.
    public func daily(_ s: TimeSeries?) -> [Double]? { Ops.align(s, to: index) }

    public func fredRaw(_ sid: String) -> TimeSeries? { fredRawSeries[sid] }

    public func fred(_ sid: String) -> [Double]? {
        if let c = cacheFred[sid] { return c }
        let v = daily(fredRawSeries[sid])
        if let v { cacheFred[sid] = v }
        return v
    }

    /// D.yf(t): forward-filled at most 5 rows.
    public func yf(_ t: String) -> [Double]? {
        if let c = cacheYahoo[t] { return c }
        let v = Ops.align(yahooRawSeries[t], to: index, limit: 5)
        if let v { cacheYahoo[t] = v }
        return v
    }

    public func yfRaw(_ t: String) -> TimeSeries? { yahooRawSeries[t] }

    /// The same data as it stood at the close of `day` (series with no data by then are dropped).
    public func truncated(through day: Day) -> RoRoData {
        func cut(_ m: [String: TimeSeries]) -> [String: TimeSeries] {
            m.compactMapValues { s in
                let k = s.days.filter { $0 <= day }.count
                return k == 0 ? nil : TimeSeries(days: Array(s.days.prefix(k)), values: Array(s.values.prefix(k)))
            }
        }
        let f = cut(fredRawSeries), y = cut(yahooRawSeries)
        let health = self.health.map { h -> RoRoHealth in
            let s = h.source == "FRED" ? f[h.id] : y[h.id]
            return RoRoHealth(source: h.source, id: h.id, status: s == nil ? "missing" : h.status, last: s?.lastDay.map(DayMath.iso))
        }
        return RoRoData(fred: f, yahoo: y, health: health, demo: demo)
    }
}

/// Compares a model with a reference JSON (numbers to 1e-9 relative; `generated` ignored).
public enum RoRoParity {
    public static func differences(_ model: JSONValue, reference: Data, limit: Int = 20) -> [String] {
        guard let a = try? JSONSerialization.jsonObject(with: reference),
              let b = try? JSONSerialization.jsonObject(with: model.serialized()) else { return ["could not parse JSON"] }
        var out: [String] = []
        func walk(_ x: Any, _ y: Any, _ path: String) {
            guard out.count < limit, path != "$.generated" else { return }
            switch (x, y) {
            case let (x as [String: Any], y as [String: Any]):
                for k in Set(x.keys).union(y.keys).sorted() {
                    guard let xv = x[k], let yv = y[k] else { out.append("\(path).\(k): missing"); continue }
                    walk(xv, yv, "\(path).\(k)")
                }
            case let (x as [Any], y as [Any]):
                guard x.count == y.count else { out.append("\(path): length \(x.count) vs \(y.count)"); return }
                for i in x.indices { walk(x[i], y[i], "\(path)[\(i)]") }
            case let (x as NSNumber, y as NSNumber):
                if CFGetTypeID(x) == CFBooleanGetTypeID() || CFGetTypeID(y) == CFBooleanGetTypeID() {
                    if x.boolValue != y.boolValue { out.append("\(path): \(x) vs \(y)") }
                } else if abs(x.doubleValue - y.doubleValue) > 1e-9 * max(1, abs(x.doubleValue)) {
                    out.append("\(path): \(x) vs \(y)")
                }
            case let (x as String, y as String):
                if x != y { out.append("\(path): \"\(x)\" vs \"\(y)\"") }
            case (is NSNull, is NSNull):
                break
            default:
                out.append("\(path): \(x) vs \(y)")
            }
        }
        walk(a, b, "$")
        return out
    }
}

// MARK: - Cache

public enum RoRoCache {
    static func safe(_ id: String) -> String {
        id.replacingOccurrences(of: "^", with: "_").replacingOccurrences(of: "=", with: "_").replacingOccurrences(of: "/", with: "_")
    }

    public static func url(_ dir: URL, kind: String, id: String) -> URL {
        dir.appendingPathComponent("\(kind)_\(safe(id)).csv")
    }

    /// Same layout as pandas Series.to_csv(header=True): ",ID" then "YYYY-MM-DD,value".
    public static func save(_ s: TimeSeries, id: String, kind: String, dir: URL) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var lines = [",\(id)"]
        lines.reserveCapacity(s.days.count + 1)
        for (d, v) in zip(s.days, s.values) where !v.isNaN { lines.append("\(DayMath.iso(d)),\(v)") }
        try (lines.joined(separator: "\n") + "\n").write(to: url(dir, kind: kind, id: id), atomically: true, encoding: .utf8)
    }

    public static func load(kind: String, id: String, dir: URL) -> TimeSeries? {
        guard let text = try? String(contentsOf: url(dir, kind: kind, id: id), encoding: .utf8) else { return nil }
        var days: [Day] = [], vals: [Double] = []
        for line in text.split(whereSeparator: \.isNewline).dropFirst() {
            let parts = line.split(separator: ",", omittingEmptySubsequences: false)
            guard parts.count >= 2, let d = DayMath.parse(String(parts[0])), let v = Double(parts[1]) else { continue }
            days.append(d); vals.append(v)
        }
        let s = TimeSeries(days: days, values: vals).dropNaN()
        return s.isEmpty ? nil : s
    }
}

// MARK: - Fetching

public enum RoRoFetcher {
    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 30
        c.httpAdditionalHeaders = ["User-Agent": "Mozilla/5.0 (Macintosh) WealthDesk-RoRo"]
        return URLSession(configuration: c)
    }()

    /// FRED's keyless CSV endpoint.
    public static func fetchFRED(_ sid: String) async throws -> TimeSeries {
        var comps = URLComponents(string: "https://fred.stlouisfed.org/graph/fredgraph.csv")!
        comps.queryItems = [URLQueryItem(name: "id", value: sid), URLQueryItem(name: "cosd", value: DayMath.iso(RoRoSources.historyStart))]
        let (data, resp) = try await session.data(from: comps.url!)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw EvalError.message("HTTP \((resp as? HTTPURLResponse)?.statusCode ?? 0)") }
        return try parseFREDCSV(String(decoding: data, as: UTF8.self))
    }

    public static func parseFREDCSV(_ text: String) throws -> TimeSeries {
        var days: [Day] = [], vals: [Double] = []
        for line in text.split(whereSeparator: \.isNewline).dropFirst() {
            let parts = line.split(separator: ",", omittingEmptySubsequences: false)
            guard parts.count >= 2, let d = DayMath.parse(String(parts[0])) else { continue }
            if let v = Double(parts[1].trimmingCharacters(in: .whitespaces)) { days.append(d); vals.append(v) }
        }
        let s = TimeSeries(days: days, values: vals)
        guard !s.isEmpty else { throw EvalError.message("no observations") }
        return s
    }

    /// Yahoo daily history (split- and dividend-adjusted close, like yfinance auto_adjust=True),
    /// dated in the exchange's time zone.
    public static func fetchYahoo(_ ticker: String, now: Date = Date()) async throws -> TimeSeries {
        let start = Int(DayMath.date(RoRoSources.historyStart).timeIntervalSince1970)
        let end = Int(now.timeIntervalSince1970) + 86_400
        guard let sym = ticker.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "^=/"))),
              let url = URL(string: "https://query1.finance.yahoo.com/v8/finance/chart/\(sym)?period1=\(start)&period2=\(end)&interval=1d&includeAdjustedClose=true&events=div%2Csplit")
        else { throw EvalError.message("bad ticker") }
        let (data, resp) = try await session.data(from: url)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw EvalError.message("HTTP \((resp as? HTTPURLResponse)?.statusCode ?? 0)") }
        return try parseYahooChart(data)
    }

    struct Chart: Decodable {
        struct Inner: Decodable { let result: [Result]? }
        struct Result: Decodable {
            struct Meta: Decodable { let exchangeTimezoneName: String?; let gmtoffset: Int? }
            struct Indicators: Decodable {
                struct Quote: Decodable { let close: [Double?]? }
                struct Adj: Decodable { let adjclose: [Double?]? }
                let quote: [Quote]?
                let adjclose: [Adj]?
            }
            let meta: Meta
            let timestamp: [Double]?
            let indicators: Indicators
        }
        let chart: Inner
    }

    public static func parseYahooChart(_ data: Data) throws -> TimeSeries {
        let c = try JSONDecoder().decode(Chart.self, from: data)
        guard let r = c.chart.result?.first, let ts = r.timestamp else { throw EvalError.message("no data") }
        let closes = r.indicators.adjclose?.first?.adjclose ?? r.indicators.quote?.first?.close ?? []
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = r.meta.exchangeTimezoneName.flatMap(TimeZone.init(identifier:))
            ?? TimeZone(secondsFromGMT: r.meta.gmtoffset ?? 0) ?? TimeZone(identifier: "UTC")!
        var days: [Day] = [], vals: [Double] = []
        for (i, t) in ts.enumerated() where i < closes.count {
            guard let v = closes[i], v.isFinite else { continue }
            let comp = cal.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: t))
            days.append(DayMath.day(comp.year!, comp.month!, comp.day!))
            vals.append(v)
        }
        let s = TimeSeries(days: days, values: vals)
        guard !s.isEmpty else { throw EvalError.message("no prices") }
        return s
    }

    /// load_live(): fetch everything (or use the cache when offline / on failure), recording per-series health.
    public static func load(cacheDir: URL, offline: Bool = false,
                            progress: (@Sendable (Int, Int) -> Void)? = nil) async -> RoRoData {
        let total = RoRoSources.fredSeries.count + RoRoSources.yahooTickers.count
        let counter = Counter()

        func fetchOne(kind: String, id: String) async -> (TimeSeries?, String) {
            defer { let n = counter.next(); progress?(n, total) }
            if !offline {
                var err = ""
                for attempt in 0..<3 {
                    do {
                        let s = kind == "fred" ? try await fetchFRED(id) : try await fetchYahoo(id)
                        try? RoRoCache.save(s, id: id, kind: kind, dir: cacheDir)
                        return (s, "ok")
                    } catch {
                        err = String(error.localizedDescription.prefix(120))
                        // No connection at all: retrying each of 60 series only delays the "offline" message.
                        if let u = error as? URLError, [.notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed,
                                                        .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff].contains(u.code) { break }
                        if (error as NSError).domain == NSPOSIXErrorDomain { break }
                        try? await Task.sleep(nanoseconds: UInt64(1 + attempt) * 700_000_000)
                    }
                }
                let cached = RoRoCache.load(kind: kind, id: id, dir: cacheDir)
                return (cached, cached == nil ? "missing" : "fetch failed (\(err)); using cache")
            }
            let cached = RoRoCache.load(kind: kind, id: id, dir: cacheDir)
            return (cached, cached == nil ? "missing" : "cache (offline)")
        }

        // A few requests at a time keeps Yahoo from rate-limiting.
        func run(kind: String, ids: [String]) async -> [String: (TimeSeries?, String)] {
            var out: [String: (TimeSeries?, String)] = [:]
            var pending = ids[...]
            await withTaskGroup(of: (String, (TimeSeries?, String)).self) { group in
                for _ in 0..<4 {
                    guard let id = pending.popFirst() else { break }
                    group.addTask { (id, await fetchOne(kind: kind, id: id)) }
                }
                while let (id, r) = await group.next() {
                    out[id] = r
                    if let nextID = pending.popFirst() { group.addTask { (nextID, await fetchOne(kind: kind, id: nextID)) } }
                }
            }
            return out
        }

        let fredResults = await run(kind: "fred", ids: RoRoSources.fredSeries)
        let yahooResults = await run(kind: "yf", ids: RoRoSources.yahooTickers)
        var fred: [String: TimeSeries] = [:], yahoo: [String: TimeSeries] = [:], health: [RoRoHealth] = []
        for id in RoRoSources.fredSeries {
            let (s, status) = fredResults[id] ?? (nil, "missing")
            if let s { fred[id] = s }
            health.append(RoRoHealth(source: "FRED", id: id, status: status, last: s?.lastDay.map(DayMath.iso)))
        }
        for id in RoRoSources.yahooTickers {
            let (s, status) = yahooResults[id] ?? (nil, "missing")
            if let s { yahoo[id] = s }
            health.append(RoRoHealth(source: "Yahoo", id: id, status: status, last: s?.lastDay.map(DayMath.iso)))
        }
        return RoRoData(fred: fred, yahoo: yahoo, health: health)
    }

    /// Builds the data object straight from a cache folder (offline / tests).
    public static func loadCache(_ dir: URL) -> RoRoData {
        var fred: [String: TimeSeries] = [:], yahoo: [String: TimeSeries] = [:], health: [RoRoHealth] = []
        for id in RoRoSources.fredSeries {
            let s = RoRoCache.load(kind: "fred", id: id, dir: dir)
            if let s { fred[id] = s }
            health.append(RoRoHealth(source: "FRED", id: id, status: s == nil ? "missing" : "ok", last: s?.lastDay.map(DayMath.iso)))
        }
        for id in RoRoSources.yahooTickers {
            let s = RoRoCache.load(kind: "yf", id: id, dir: dir)
            if let s { yahoo[id] = s }
            health.append(RoRoHealth(source: "Yahoo", id: id, status: s == nil ? "missing" : "ok", last: s?.lastDay.map(DayMath.iso)))
        }
        return RoRoData(fred: fred, yahoo: yahoo, health: health)
    }

    final class Counter: @unchecked Sendable {
        private var n = 0
        private let lock = NSLock()
        func next() -> Int { lock.lock(); defer { lock.unlock() }; n += 1; return n }
    }
}
