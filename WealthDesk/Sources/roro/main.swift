import Foundation
import WealthCore

// Developer tool for the RoRo port, also used by the web build.
//   roro fetch <cacheDir>                 download every series into the cache
//   roro build <cacheDir> <out.json>      score the model from the cache and write its JSON
//   roro meta <out.json>                  factor score maps, data series and weights (for the web Factors tab)
//   roro markets <out.json> [SYM ...]     Treasury yield curve and delayed quotes (web Markets snapshot)
let args = CommandLine.arguments
func usage() -> Never {
    print("usage: roro fetch <cacheDir> | roro build <cacheDir> <out.json> | roro meta <out.json> | roro markets <out.json> [SYM ...]")
    exit(2)
}
guard args.count >= 3 else { usage() }

func runAsync(_ body: @escaping () async -> Void) {
    let sem = DispatchSemaphore(value: 0)
    Task { await body(); sem.signal() }
    sem.wait()
}

func write(_ v: JSONValue, _ path: String) {
    try! v.serialized(pretty: false).write(to: URL(fileURLWithPath: path))
    print("wrote \(path)")
}

switch args[1] {
case "fetch":
    let cache = URL(fileURLWithPath: args[2])
    runAsync {
        let start = Date()
        let d = await RoRoFetcher.load(cacheDir: cache) { n, total in
            if n % 10 == 0 || n == total { FileHandle.standardError.write("  \(n)/\(total)\n".data(using: .utf8)!) }
        }
        let bad = d.health.filter { $0.status != "ok" }
        print("fetched \(d.fredRawSeries.count) FRED + \(d.yahooRawSeries.count) Yahoo series in \(Int(Date().timeIntervalSince(start)))s; last business day \(DayMath.iso(d.index.last!))")
        for h in bad { print("  \(h.source) \(h.id): \(h.status)") }
    }
case "build":
    guard args.count >= 4 else { usage() }
    let d = RoRoFetcher.loadCache(URL(fileURLWithPath: args[2]))
    let model = RoRoEngine.build(d, lastRun: nil)
    try! model.serialized(pretty: true).write(to: URL(fileURLWithPath: args[3]))
    print("wrote \(args[3])")
case "meta":
    let factors: [JSONValue] = RoRoConfig.factors.map { f in
        .object([
            ("id", .string(f.id)), ("bucket", .string(f.bucket)), ("scale", .number(f.scale)),
            ("map", .array(f.map.map { .array([.number($0.0), .number($0.1)]) })),
            ("series", .array((RoRoConfig.factorSeries[f.id] ?? []).map { .object([("source", .string($0.source)), ("id", .string($0.id))]) })),
        ])
    }
    let weights: [(String, JSONValue)] = RoRoConfig.horizons.map { h in
        (h, .object(RoRoConfig.bucketKeys.map { ($0, .number(RoRoConfig.horizonWeights[h]?[$0] ?? 0)) }))
    }
    write(.object([
        ("buckets", .array(RoRoConfig.buckets.map { .object([("id", .string($0.0)), ("name", .string($0.1))]) })),
        ("horizons", .array(RoRoConfig.horizons.map { .object([("id", .string($0)), ("label", .string(RoRoConfig.horizonMeta[$0]?.label ?? $0))]) })),
        ("weights", .object(weights)),
        ("factors", .array(factors)),
        ("fredCount", .number(Double(RoRoSources.fredSeries.count))),
        ("yahooCount", .number(Double(RoRoSources.yahooTickers.count))),
    ]), args[2])
case "markets":
    let symbols = args.count > 3 ? Array(args[3...]) : ["SPY", "VTI", "BND", "AGG"]
    let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 20
        c.httpAdditionalHeaders = ["User-Agent": "Mozilla/5.0 (Macintosh) WealthDesk"]
        return URLSession(configuration: c)
    }()
    var out: [(String, JSONValue)] = [("generated", .string(ISO8601DateFormatter().string(from: Date())))]
    runAsync {
        let year = Calendar(identifier: .gregorian).component(.year, from: Date())
        for y in [year, year - 1] {
            guard let (data, _) = try? await session.data(from: MarketParsers.treasuryURL(year: y)),
                  let c = MarketParsers.parseTreasuryCSV(String(decoding: data, as: UTF8.self)) else { continue }
            out.append(("curve", .object([
                ("date", .string(c.date)),
                ("points", .array(c.points.map { p in
                    .object([("label", .string(p.label)), ("years", .number(p.years)), ("rate", .number(p.rate)),
                             ("prior", c.prior[p.label].map(JSONValue.number) ?? .null)])
                })),
            ])))
            break
        }
        var quotes: [JSONValue] = []
        for s in symbols {
            guard let url = MarketParsers.quoteURL(symbol: s) else { continue }
            do {
                let (data, _) = try await session.data(from: url)
                let q = try MarketParsers.parseQuote(data)
                quotes.append(.object([
                    ("symbol", .string(s)), ("name", .string(q.name)), ("price", .number(q.price)),
                    ("previousClose", .number(q.previousClose)),
                    ("dayLow", q.dayLow.map(JSONValue.number) ?? .null), ("dayHigh", q.dayHigh.map(JSONValue.number) ?? .null),
                    ("low52", q.low52.map(JSONValue.number) ?? .null), ("high52", q.high52.map(JSONValue.number) ?? .null),
                    ("currency", .string(q.currency)), ("time", .string(ISO8601DateFormatter().string(from: q.time))),
                ]))
            } catch {
                quotes.append(.object([("symbol", .string(s)), ("error", .string(error.localizedDescription))]))
            }
        }
        out.append(("quotes", .array(quotes)))
    }
    write(.object(out), args[2])
default:
    usage()
}
