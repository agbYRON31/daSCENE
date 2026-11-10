import Foundation

/// One maturity point on the Treasury par yield curve.
public struct YieldPoint: Equatable, Identifiable {
    public var id: String { label }
    public let label: String    // e.g. "10 Yr"
    public let years: Double    // maturity in years
    public let rate: Double     // decimal, 0.0498 = 4.98%
}

public struct YieldCurve: Equatable {
    public let date: String
    public let points: [YieldPoint]
    public let prior: [String: Double]   // previous day's rates by label

    public func rate(_ label: String) -> Double? { points.first { $0.label == label }?.rate }

    /// Spread in percentage points (decimal), e.g. 10 Yr − 2 Yr.
    public func spread(_ long: String, _ short: String) -> Double? {
        guard let l = rate(long), let s = rate(short) else { return nil }
        return l - s
    }
}

public struct Quote: Equatable, Identifiable {
    public var id: String { symbol }
    public let symbol: String
    public let name: String
    public let price: Double
    public let previousClose: Double
    public let dayLow: Double?
    public let dayHigh: Double?
    public let low52: Double?
    public let high52: Double?
    public let currency: String
    public let time: Date

    public var change: Double { price - previousClose }
    public var changePercent: Double { previousClose != 0 ? price / previousClose - 1 : 0 }
}

/// Parsers for the free, no-key data sources. Network calls live in the app.
public enum MarketParsers {
    /// Official U.S. Treasury daily par yield curve CSV for a year.
    public static func treasuryURL(year: Int) -> URL {
        URL(string: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/\(year)/all?type=daily_treasury_yield_curve&field_tdr_date_value=\(year)&page&_format=csv")!
    }

    /// Unofficial Yahoo Finance chart endpoint (no key). May change without notice.
    public static func quoteURL(symbol: String) -> URL? {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-^=_"))
        guard !symbol.isEmpty, symbol.unicodeScalars.allSatisfy(allowed.contains),
              let enc = symbol.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
        return URL(string: "https://query1.finance.yahoo.com/v8/finance/chart/\(enc)?range=1d&interval=1d")
    }

    /// Maturity in years from a Treasury column label ("1 Mo", "1.5 Month", "10 Yr").
    static func years(for label: String) -> Double? {
        let parts = label.split(separator: " ")
        guard parts.count == 2, let n = Double(parts[0]) else { return nil }
        let unit = parts[1].lowercased()
        if unit.hasPrefix("mo") { return n / 12 }
        if unit.hasPrefix("yr") || unit.hasPrefix("year") { return n }
        return nil
    }

    /// Parses the Treasury CSV (newest row first). Returns nil if there are no rows.
    public static func parseTreasuryCSV(_ csv: String) -> YieldCurve? {
        let lines = csv.split(whereSeparator: \.isNewline).map(String.init).filter { !$0.isEmpty }
        guard lines.count >= 2 else { return nil }
        let header = lines[0].split(separator: ",").map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\" ")) }
        func row(_ line: String) -> [String] { line.split(separator: ",", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\" ")) } }
        let latest = row(lines[1])
        let previous = lines.count > 2 ? row(lines[2]) : []
        var points: [YieldPoint] = []
        var prior: [String: Double] = [:]
        for (i, label) in header.enumerated() where i > 0 {
            guard let y = years(for: label) else { continue }
            if i < latest.count, let r = Double(latest[i]) {
                points.append(YieldPoint(label: label, years: y, rate: r / 100))
            }
            if i < previous.count, let r = Double(previous[i]) { prior[label] = r / 100 }
        }
        guard !points.isEmpty else { return nil }
        return YieldCurve(date: latest[0], points: points.sorted { $0.years < $1.years }, prior: prior)
    }

    struct ChartResponse: Decodable {
        struct Chart: Decodable {
            let result: [Result]?
            let error: ErrorInfo?
        }
        struct ErrorInfo: Decodable { let description: String? }
        struct Result: Decodable { let meta: Meta }
        struct Meta: Decodable {
            let symbol: String
            let currency: String?
            let longName: String?
            let shortName: String?
            let regularMarketPrice: Double?
            let chartPreviousClose: Double?
            let previousClose: Double?
            let regularMarketDayLow: Double?
            let regularMarketDayHigh: Double?
            let fiftyTwoWeekLow: Double?
            let fiftyTwoWeekHigh: Double?
            let regularMarketTime: Double?
        }
        let chart: Chart
    }

    public static func parseQuote(_ data: Data) throws -> Quote {
        let r = try JSONDecoder().decode(ChartResponse.self, from: data)
        guard let m = r.chart.result?.first?.meta, let price = m.regularMarketPrice else {
            throw EvalError.message(r.chart.error?.description ?? "No quote found for that symbol.")
        }
        return Quote(symbol: m.symbol, name: m.longName ?? m.shortName ?? m.symbol, price: price,
                     previousClose: m.chartPreviousClose ?? m.previousClose ?? price,
                     dayLow: m.regularMarketDayLow, dayHigh: m.regularMarketDayHigh,
                     low52: m.fiftyTwoWeekLow, high52: m.fiftyTwoWeekHigh,
                     currency: m.currency ?? "USD",
                     time: Date(timeIntervalSince1970: m.regularMarketTime ?? Date().timeIntervalSince1970))
    }
}
