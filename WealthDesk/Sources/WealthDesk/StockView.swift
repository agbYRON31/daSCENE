import Charts
import SwiftUI
import WealthCore

/// Stock research: one ticker at a time. Prices come straight from Yahoo's chart feed; SEC figures and
/// the ticker list come through Wealth Desk's lookup service (the SEC asks automated tools to name a
/// contact, which is set on that server, not in this app). Only the symbol is sent. Nothing is saved.
@MainActor
final class StockStore: ObservableObject {
    static let api = "https://da-scene.vercel.app/api/stock"
    @Published var symbol = ""
    @Published var loading = false
    @Published var report: StockReport?
    @Published var error: String?
    @Published var note: String?
    @Published var tickers: [String: (Int, String)]?
    var tickersFailed = false

    private let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 25
        c.httpAdditionalHeaders = ["User-Agent": "Mozilla/5.0 (Macintosh) WealthDesk"]
        return URLSession(configuration: c)
    }()

    init() {
        NotificationCenter.default.addObserver(forName: .wealthDeskSessionCleared, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.clear() }
        }
    }

    func clear() { symbol = ""; report = nil; error = nil; note = nil }

    func loadTickers() async {
        guard tickers == nil, !tickersFailed, let url = URL(string: "\(Self.api)?list=tickers") else { return }
        do {
            let (d, r) = try await session.data(from: url)
            guard (r as? HTTPURLResponse)?.statusCode == 200, let o = try JSONSerialization.jsonObject(with: d) as? [String: [Any]] else { tickersFailed = true; return }
            var m: [String: (Int, String)] = [:]
            for (k, v) in o where v.count == 2 { m[k] = ((v[0] as? NSNumber)?.intValue ?? 0, v[1] as? String ?? "") }
            tickers = m
        } catch { tickersFailed = true }
    }

    func matches(_ q: String) -> [String] {
        guard let t = tickers, !q.isEmpty else { return [] }
        let Q = q.uppercased()
        var out: [String] = t[Q] != nil ? [Q] : []
        for k in t.keys.sorted() where out.count < 8 && k != Q && k.hasPrefix(Q) { out.append(k) }
        if out.count < 8 && Q.count >= 3 {
            for k in t.keys.sorted() where out.count < 8 && !out.contains(k) && t[k]!.1.uppercased().contains(Q) { out.append(k) }
        }
        return out
    }

    private func json(_ url: URL) async throws -> Any {
        let (d, r) = try await session.data(from: url)
        let code = (r as? HTTPURLResponse)?.statusCode ?? 0
        if code == 404 { throw EvalError.message("No data for that symbol.") }
        guard code == 200 else { throw EvalError.message("The data source answered \(code). Try again shortly.") }
        return try JSONSerialization.jsonObject(with: d)
    }

    static func chartURL(_ sym: String, intraday: Bool = false) -> URL? {
        guard let s = sym.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(.init(charactersIn: ".-"))) else { return nil }
        if intraday { return URL(string: "https://query1.finance.yahoo.com/v8/finance/chart/\(s)?range=1d&interval=5m") }
        let now = Int(Date().timeIntervalSince1970), p1 = now - Int((10 * 365.25 + 20) * 86400)
        return URL(string: "https://query1.finance.yahoo.com/v8/finance/chart/\(s)?period1=\(p1)&period2=\(now)&interval=1d&events=div%2Csplit&includeAdjustedClose=true")
    }

    func lookup(_ raw: String) {
        let sym = raw.trimmingCharacters(in: .whitespaces).uppercased().replacingOccurrences(of: ".", with: "-")
        guard !sym.isEmpty else { return }
        guard sym.range(of: #"^[A-Z0-9][A-Z0-9\-^=]{0,14}$"#, options: .regularExpression) != nil else { error = "That isn't a valid ticker symbol."; report = nil; return }
        symbol = sym; loading = true; error = nil; note = nil
        Task {
            await loadTickers()
            let cik = tickers?[sym]?.0
            do {
                async let daily = json(Self.chartURL(sym)!)
                async let bench = json(Self.chartURL("SPY")!)
                async let intra: Any? = try? await json(Self.chartURL(sym, intraday: true)!)
                async let sec: Any? = cik == nil ? nil : try? await json(URL(string: "\(Self.api)?cik=\(cik!)&only=sec")!)
                let secO = await sec as? [String: Any]
                let input = StockInput(daily: try ChartData(json: try await daily), intraday: (await intra).flatMap { try? ChartData(json: $0) },
                                       bench: try ChartData(json: try await bench), facts: secO?["facts"] as? [String: Any], subs: secO?["subs"] as? [String: Any])
                let r = try StockMath.analyze(input)
                guard symbol == sym else { return }
                report = r
                if cik == nil {
                    note = tickersFailed ? "The SEC's company list couldn't be loaded, so fundamentals aren't shown."
                        : "This symbol isn't on the SEC's list of operating companies (funds and many foreign companies aren't), so only price data is shown."
                } else if secO == nil {
                    note = "Wealth Desk's lookup service for SEC data didn't answer, so fundamentals aren't shown."
                } else if r.annual.isEmpty {
                    note = (secO?["factsError"] as? String) ?? "The SEC has no financial statements in XBRL for this company."
                }
            } catch {
                guard symbol == sym else { return }
                report = nil
                self.error = (error as? URLError) != nil ? "Couldn't reach the data source. Check the connection and try again." : error.localizedDescription
            }
            loading = false
        }
    }
}

extension Notification.Name { static let wealthDeskSessionCleared = Notification.Name("WealthDeskSessionCleared") }

private enum F {
    static func pct1(_ v: Double?) -> String { v.map { String(format: "%@%.1f%%", $0 >= 0 ? "+" : "−", abs($0 * 100)) } ?? "—" }
    static func pct(_ v: Double?) -> String { v.map { String(format: "%.1f%%", $0 * 100) } ?? "—" }
    static func pct2(_ v: Double?) -> String { v.map { String(format: "%.2f%%", $0 * 100) } ?? "—" }
    static func mult(_ v: Double?) -> String { v.map { String(format: "%.1f×", $0) } ?? "—" }
    static func money(_ v: Double?) -> String { v.map { Format.plain($0, maxDecimals: 2) } ?? "—" }
    static func big(_ v: Double?) -> String {
        guard let v else { return "—" }
        let a = abs(v), s = v < 0 ? "−" : ""
        if a >= 1e12 { return String(format: "%@$%.2fT", s, a / 1e12) }
        if a >= 1e9 { return String(format: "%@$%.1fB", s, a / 1e9) }
        if a >= 1e6 { return String(format: "%@$%.1fM", s, a / 1e6) }
        if a >= 1e3 { return String(format: "%@$%.0fK", s, a / 1e3) }
        return String(format: "%@$%.0f", s, a)
    }
    static func date(_ s: String?, style: String = "MMM d, yyyy") -> String {
        guard let s, let d = ISO8601DateFormatter.day.date(from: s) else { return "—" }
        let f = DateFormatter(); f.dateFormat = style; f.timeZone = TimeZone(identifier: "UTC"); return f.string(from: d)
    }
    static func day(_ n: Int) -> Date { Date(timeIntervalSince1970: Double(n) * 86400) }
}
extension ISO8601DateFormatter {
    static let day: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]; return f }()
}

struct StockView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var stock: StockStore
    @State private var query = ""
    @State private var range = "1Y"
    @State private var vsBench = true
    @State private var tab = "Overview"
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Stock research").font(.title.weight(.semibold))
                    Text("One company at a time: price history, risk, fundamentals from SEC filings, valuation and filings. Facts and history only. No ratings, targets or recommendations.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                search
                if stock.loading {
                    ProgressView("Looking up \(stock.symbol)…").frame(maxWidth: .infinity)
                } else if let e = stock.error {
                    ContentUnavailable(title: "Couldn't look up \(stock.symbol)", message: e, symbol: "exclamationmark.triangle")
                } else if let r = stock.report {
                    result(r)
                } else {
                    ContentUnavailable(title: "Look up a stock", message: "Type a ticker symbol above. Suggestions come from the SEC's list of listed companies.", symbol: "magnifyingglass")
                }
                Text("Looking up a symbol sends only that symbol: to Yahoo Finance for prices, and to Wealth Desk's lookup service for SEC data. Nothing is saved; the result is cleared with the session.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(18)
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Stock research")
        .navigationSubtitle(stock.report.map { "\($0.symbol) · \($0.name ?? "")" } ?? "")
        .toolbar {
            Button { stock.lookup(stock.symbol) } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                .disabled(stock.report == nil || stock.loading)
        }
        .onAppear { if query.isEmpty { query = stock.symbol }; Task { await stock.loadTickers() } }
    }

    private var search: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Ticker symbol, e.g. AAPL", text: $query)
                        .textFieldStyle(.plain).focused($focused)
                        .onSubmit { focused = false; stock.lookup(query) }
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(Color.wealthCard, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12)))
                Button("Look up") { focused = false; stock.lookup(query) }.buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: 520)
            let m = focused ? stock.matches(query.trimmingCharacters(in: .whitespaces)) : []
            if !m.isEmpty && m.first != stock.report?.symbol {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(m, id: \.self) { k in
                        Button { query = k; focused = false; stock.lookup(k) } label: {
                            HStack { Text(k).fontWeight(.semibold); Text(stock.tickers?[k]?.1 ?? "").foregroundStyle(.secondary).lineLimit(1); Spacer() }
                                .padding(.horizontal, 10).padding(.vertical, 5).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
                .frame(maxWidth: 520)
                .background(Color.wealthCard, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12)))
            }
        }
    }

    private func isFinancial(_ r: StockReport) -> Bool {
        (r.company?.sic ?? "").range(of: "bank|insur|financ|savings|credit|reit|real estate invest", options: [.regularExpression, .caseInsensitive]) != nil
    }

    @ViewBuilder private func result(_ r: StockReport) -> some View {
        Picker("Section", selection: $tab) { ForEach(["Overview", "Financials", "Valuation", "Filings"], id: \.self) { Text($0).tag($0) } }
            .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 520)
        let none = Card(title: "Fundamentals") { Text(stock.note ?? "No financial statements are available for this symbol.").foregroundStyle(.secondary) }
        switch tab {
        case "Financials":
            if r.annual.isEmpty { none } else { earningsCard(r); statementsCard(r) }
        case "Valuation":
            if r.annual.isEmpty { none } else { sizeCard(r); valuationCard(r) }
        case "Filings":
            if r.filings.isEmpty { Card(title: "Recent SEC filings") { Text("No SEC filings are available for this symbol.").foregroundStyle(.secondary) } } else { filingsCard(r) }
        default:
            quoteCard(r)
            priceCard(r)
            returnsCard(r)
            riskCard(r)
            calculatorsCard(r)
            Card(title: "Market backdrop", trailing: AnyView(Button("RoRo Composite") { state.selection = .roro }.buttonStyle(.plain).foregroundStyle(Color.wealthAccent))) {
                Text("The RoRo Composite describes overall market conditions, not this stock, and doesn't predict returns.").foregroundStyle(.secondary)
            }
        }
        Text("Sources: prices, dividends and splits from Yahoo Finance's chart feed (unofficial and unlicensed; quotes are delayed). Financial statements and filings from SEC EDGAR (official XBRL company facts and filing index). S&P 500 comparison uses SPY, an exchange-traded fund that tracks it. Figures can contain errors in the source data. This is factual information for education and discussion, not a recommendation to buy, sell or hold any security.")
            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }

    private func kv(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.caption).foregroundStyle(.secondary)
            Text(v).font(.headline).monospacedDigit()
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func tile(_ t: String, _ v: String, _ sub: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(t).font(.callout).foregroundStyle(.secondary)
            Text(v).font(.wealthSerif(20)).monospacedDigit()
            if let sub { Text(sub).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func quoteCard(_ r: StockReport) -> some View {
        let q = r.quote, price = q["price"] ?? nil, ch = q["change"] ?? nil, pct = q["changePct"] ?? nil
        let hi = q["high52"] ?? nil, lo = q["low52"] ?? nil
        let fin = isFinancial(r)
        return Card(title: r.symbol) {
            HStack(alignment: .top) {
                Text([r.name, r.exchange, r.company?.sic].compactMap { $0 }.joined(separator: " · ")).foregroundStyle(.secondary)
                Spacer()
                VStack(alignment: .trailing) {
                    Text(F.money(price) + (r.currency == "USD" ? "" : " \(r.currency)")).font(.wealthSerif(28)).monospacedDigit()
                    if let ch, let pct {
                        Text(String(format: "%@%.2f (%@%.2f%%) today", ch >= 0 ? "+" : "−", abs(ch), ch >= 0 ? "+" : "−", abs(pct * 100)))
                            .monospacedDigit().foregroundStyle(ch >= 0 ? Color.green : Color.red)
                    }
                }
            }
            if let hi, let lo, let price, hi > lo {
                HStack {
                    Text("52-week low \(F.money(lo))").font(.caption).foregroundStyle(.secondary)
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.primary.opacity(0.1)).frame(height: 4)
                            Capsule().fill(Color.wealthAccent).frame(width: 4, height: 12)
                                .offset(x: max(0, min(1, (price - lo) / (hi - lo))) * (g.size.width - 4))
                        }.frame(maxHeight: .infinity)
                    }.frame(height: 14)
                    Text("high \(F.money(hi))").font(.caption).foregroundStyle(.secondary)
                }
            }
            HStack {
                kv("Market value", F.big(r.valuation["marketCap"] ?? nil))
                kv("P/E (trailing)", F.mult(r.valuation["pe"] ?? nil))
                kv("Dividend yield", F.pct2(r.valuation["divYield"] ?? nil))
                kv("1-year return", F.pct1(r.returns.first { $0.key == "1Y" }?.stock))
                kv("Beta (5 years)", (r.risk["beta5y"] ?? nil).map { String(format: "%.2f", $0) } ?? "—")
            }
            Text("Delayed quote, last trading day \(F.date(r.lastDay)). Market value = price × shares outstanding from the latest filing (\(F.date(r.balanceAsOf["shares"] ?? nil))).")
                .font(.caption).foregroundStyle(.tertiary)
        }
    }

    private func sizeCard(_ r: StockReport) -> some View {
        let fin = isFinancial(r)
        return Card(title: "Company size") {
            HStack {
                kv("Market value", F.big(r.valuation["marketCap"] ?? nil))
                kv("Enterprise value", fin ? "n/m" : F.big(r.valuation["ev"] ?? nil))
                kv("Cash", F.big(r.balance["cash"] ?? nil))
                kv("Long-term debt", F.big(r.balance["debt"] ?? nil))
                kv("Shares outstanding", (r.balance["sharesOut"] ?? nil).map { String(format: "%.2fB", $0 / 1e9) } ?? "—")
            }
            Text("Enterprise value = market value + long-term debt − cash, from the latest balance sheet (\(F.date(r.balanceAsOf["cash"] ?? nil))).")
                .font(.caption).foregroundStyle(.tertiary)
        }
    }

    struct Pt: Identifiable { let id: Int; let x: Date; let y: Double; let series: String }

    private func priceCard(_ r: StockReport) -> some View {
        let ranges = ["1D", "1M", "6M", "YTD", "1Y", "5Y", "10Y"]
        var pts: [Pt] = []
        if range == "1D" {
            pts = r.intraday.enumerated().map { Pt(id: $0.offset, x: Date(timeIntervalSince1970: $0.element.0), y: $0.element.1, series: r.symbol) }
        } else if let last = r.bars.last {
            let (y, _, _) = StockMath.ymd(last.day)
            let from: Int
            switch range {
            case "1M": from = StockMathShift.back(last.day, months: 1)
            case "6M": from = StockMathShift.back(last.day, months: 6)
            case "YTD": from = StockMath.days(y - 1, 12, 31)
            case "1Y": from = StockMathShift.back(last.day, months: 12)
            case "5Y": from = StockMathShift.back(last.day, months: 60)
            default: from = StockMathShift.back(last.day, months: 120)
            }
            var i0 = r.bars.firstIndex { $0.day >= from } ?? 0
            if i0 > 0 && r.bars[i0].day > from { i0 -= 1 }
            let slice = Array(r.bars[i0...])
            let step = max(1, slice.count / 600)
            let pick = slice.enumerated().filter { $0.offset % step == 0 || $0.offset == slice.count - 1 }.map(\.element)
            if vsBench, let base = pick.first {
                let bm = Dictionary(r.benchBars.map { ($0.day, $0.adj) }, uniquingKeysWith: { a, _ in a })
                pts = pick.enumerated().map { Pt(id: $0.offset, x: F.day($0.element.day), y: $0.element.adj / base.adj * 100, series: r.symbol) }
                if let bb = bm[base.day] {
                    pts += pick.enumerated().compactMap { e in bm[e.element.day].map { Pt(id: 100_000 + e.offset, x: F.day(e.element.day), y: $0 / bb * 100, series: "S&P 500 (SPY)") } }
                }
            } else {
                pts = pick.enumerated().map { Pt(id: $0.offset, x: F.day($0.element.day), y: $0.element.close, series: r.symbol) }
            }
        }
        return Card(title: "Price", trailing: AnyView(HStack {
            if range != "1D" { Toggle("Compare with S&P 500", isOn: $vsBench).toggleStyle(.checkbox).font(.caption) }
            Picker("", selection: $range) { ForEach(ranges, id: \.self) { Text($0).tag($0) } }.pickerStyle(.segmented).labelsHidden().frame(width: 330)
        })) {
            if pts.count < 2 {
                Text(range == "1D" ? "No trading yet today." : "Not enough history.").foregroundStyle(.secondary)
            } else {
                Chart(pts) { p in
                    LineMark(x: .value("Date", p.x), y: .value("Value", p.y), series: .value("Series", p.series))
                        .foregroundStyle(by: .value("Series", p.series))
                        .lineStyle(StrokeStyle(lineWidth: p.series == r.symbol ? 2 : 1.4))
                }
                .chartForegroundStyleScale([r.symbol: Color.wealthAccent, "S&P 500 (SPY)": Color.secondary])
                .chartLegend(range != "1D" && vsBench ? .visible : .hidden)
                .chartYScale(domain: .automatic(includesZero: false))
                .frame(height: 240)
            }
            Text(range == "1D" ? "Today, 5-minute prices." : vsBench ? "Growth of 100 with dividends reinvested, for the stock and SPY (an S&P 500 fund)." : "Closing prices, adjusted for splits.")
                .font(.caption).foregroundStyle(.tertiary)
        }
    }

    private func returnsCard(_ r: StockReport) -> some View {
        Card(title: "Returns", trailing: AnyView(Text("Dividends reinvested · 3, 5 and 10 years are per year").font(.caption).foregroundStyle(.secondary))) {
            ScrollView(.horizontal) {
                Grid(alignment: .trailing, horizontalSpacing: 18, verticalSpacing: 6) {
                    GridRow { Text("").gridColumnAlignment(.leading); ForEach(r.returns, id: \.key) { Text($0.key).font(.caption.weight(.semibold)).foregroundStyle(.secondary) } }
                    Divider()
                    GridRow {
                        Text(r.symbol)
                        ForEach(r.returns, id: \.key) { x in Text(F.pct1(x.stock)).foregroundStyle(x.stock == nil ? Color.secondary : (x.stock! >= 0 ? Color.green : Color.red)) }
                    }
                    GridRow { Text("S&P 500 (SPY)").foregroundStyle(.secondary); ForEach(r.returns, id: \.key) { Text(F.pct1($0.bench)).foregroundStyle(.secondary) } }
                    GridRow {
                        Text("Difference").foregroundStyle(.secondary)
                        ForEach(r.returns, id: \.key) { x in Text(x.stock == nil || x.bench == nil ? "—" : F.pct1(x.stock! - x.bench!)).foregroundStyle(.secondary) }
                    }
                }.monospacedDigit()
            }
        }
    }

    private func riskCard(_ r: StockReport) -> some View {
        let k = r.risk, b = k["beta5y"] ?? nil, dd = k["maxDD"] ?? nil, cur = k["currentDD"] ?? nil
        let peak = r.ddDays["peakDay"] ?? nil, trough = r.ddDays["troughDay"] ?? nil, rec = r.ddDays["recoveryDay"] ?? nil
        return Card(title: "Risk") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 12)], spacing: 12) {
                tile("Volatility, last year", F.pct(k["vol1y"] ?? nil), "S&P 500: \(F.pct(k["benchVol1y"] ?? nil))")
                tile("Beta (5 years, monthly)", b.map { String(format: "%.2f", $0) } ?? "—", b == nil ? "Needs 24 months (has \(r.betaMonths))" : "\(r.betaMonths) months against SPY")
                tile("Largest fall (10 years)", dd.map { String(format: "−%.1f%%", $0 * 100) } ?? "—",
                     peak.map { "\(F.date($0, style: "MMM yyyy")) to \(F.date(trough, style: "MMM yyyy")); \(rec.map { "back by " + F.date($0, style: "MMM yyyy") } ?? "not yet recovered")" })
                tile("Below its 10-year high", cur.map { $0 < 0.0005 ? "At the high" : String(format: "−%.1f%%", $0 * 100) } ?? "—", "Dividends reinvested")
            }
            Text("Volatility: how much daily returns swing, per year. Beta: how much the stock has tended to move when the S&P 500 moves 1%. Both describe the past, not the future.")
                .font(.caption).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func valuationCard(_ r: StockReport) -> some View {
        let v = r.valuation, m = r.medians, fin = isFinancial(r)
        func vt(_ label: String, _ k: String, _ f: (Double?) -> String, _ none: String? = nil) -> some View {
            tile(label, f(v[k] ?? nil), (m[k] ?? nil).map { "10-year median \(f($0))" } ?? none ?? "No 10-year median")
        }
        let eps = r.ttm["eps"] ?? nil, g5 = r.dividends["growth5"] ?? nil
        return Card(title: "Valuation", trailing: AnyView(Text("Trailing 12 months through \(F.date((r.ttmThrough["eps"] ?? nil) ?? (r.ttmThrough["revenue"] ?? nil)))").font(.caption).foregroundStyle(.secondary))) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 12)], spacing: 12) {
                vt("Price / earnings", "pe", F.mult, eps != nil && eps! <= 0 ? "Earnings negative, so n/m" : nil)
                vt("Price / sales", "ps", F.mult)
                tile("Price / book", F.mult(v["pb"] ?? nil), "Book = shareholders' equity")
                if fin {
                    tile("EV / EBITDA", "n/m", "Not meaningful for banks and insurers")
                    tile("Free cash flow yield", "n/m", "Not meaningful for banks and insurers")
                } else {
                    vt("EV / EBITDA", "evEbitda", F.mult)
                    vt("Free cash flow yield", "fcfYield", F.pct2)
                }
                tile("Dividend yield", F.pct2(v["divYield"] ?? nil), g5.map { "Dividend grew \(F.pct($0)) a year over 5 years" } ?? "No 5-year dividend growth")
            }
            Text("Medians use each fiscal year-end's share price with that year's results. Today's figures use the latest price with trailing-12-month results. History is context, not a sign of what comes next.")
                .font(.caption).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
        }
    }

    struct Bar2: Identifiable { let id: String; let label: String; let kind: String; let v: Double }

    private func earningsCard(_ r: StockReport) -> some View {
        let bars = r.annual.flatMap { row -> [Bar2] in
            let l = F.date(row.end, style: "MMM yyyy")
            return [row["revenue"].map { Bar2(id: l + "r", label: l, kind: "Revenue", v: $0) }, row["netIncome"].map { Bar2(id: l + "n", label: l, kind: "Net income", v: $0) }].compactMap { $0 }
        }
        let g = r.growth, rc = g["revenueCAGR"] ?? nil, ec = g["epsCAGR"] ?? nil, yrs = g["years"] ?? nil
        return Card(title: "Revenue and earnings", trailing: rc == nil ? nil : AnyView(Text("Revenue \(F.pct(rc)) a year · EPS \(F.pct(ec)) a year over \(String(format: "%.0f", yrs ?? 0)) years").font(.caption).foregroundStyle(.secondary))) {
            Chart(bars) { b in
                BarMark(x: .value("Year", b.label), y: .value("Amount", b.v)).foregroundStyle(by: .value("Line", b.kind)).position(by: .value("Line", b.kind))
            }
            .chartForegroundStyleScale(["Revenue": Color.wealthAccent, "Net income": Color.secondary])
            .chartYAxis { AxisMarks { v in AxisGridLine(); AxisValueLabel { if let d = v.as(Double.self) { Text(F.big(d)) } } } }
            .frame(height: 220)
        }
    }

    private func statementsCard(_ r: StockReport) -> some View {
        let rows: [(String, String, (Double?) -> String)] = [
            ("Revenue", "revenue", F.big), ("Revenue growth", "revGrowth", F.pct1), ("Gross margin", "grossMargin", F.pct2), ("Operating income", "opIncome", F.big),
            ("Operating margin", "opMargin", F.pct2), ("Net income", "netIncome", F.big), ("Net margin", "netMargin", F.pct2), ("Diluted EPS", "eps", F.money),
            ("EPS growth", "epsGrowth", F.pct1), ("Operating cash flow", "ocf", F.big), ("Capital spending", "capex", F.big), ("Free cash flow", "fcf", F.big),
            ("FCF margin", "fcfMargin", F.pct2), ("Diluted shares", "shares", { $0.map { String(format: "%.2fB", $0 / 1e9) } ?? "—" }),
            ("Cash", "cash", F.big), ("Long-term debt", "debt", F.big), ("Shareholders' equity", "equity", F.big), ("Dividends per share", "dps", F.money),
            ("Year-end price", "price", F.money), ("P/E at year end", "pe", F.mult), ("P/S at year end", "ps", F.mult),
        ]
        let ttmKeys: Set<String> = ["revenue", "opIncome", "netIncome", "eps", "ocf", "capex", "fcf"]
        return Card(title: "Financial statements", trailing: AnyView(Text("Fiscal years from 10-K filings · per-share figures on today's share basis").font(.caption).foregroundStyle(.secondary))) {
            ScrollView(.horizontal) {
                Grid(alignment: .trailing, horizontalSpacing: 16, verticalSpacing: 5) {
                    GridRow {
                        Text("").gridColumnAlignment(.leading)
                        ForEach(r.annual, id: \.end) { Text(F.date($0.end, style: "MMM yyyy")).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                        Text("TTM").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    Divider()
                    ForEach(rows, id: \.1) { label, k, f in
                        GridRow {
                            Text(label)
                            ForEach(r.annual, id: \.end) { Text(f($0[k])) }
                            Text(ttmKeys.contains(k) ? f(r.ttm[k] ?? nil) : "").foregroundStyle(.secondary)
                        }
                    }
                }.font(.callout).monospacedDigit()
            }
            Text("Each figure is the most recently filed value for that period, so restated numbers replace originals. TTM = last fiscal year + this year to date − the same period last year. Blank (—) means the company doesn't report that line in a standard form.")
                .font(.caption).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func filingsCard(_ r: StockReport) -> some View {
        Card(title: "Recent SEC filings") {
            ForEach(r.filings) { f in
                Link(destination: URL(string: f.url)!) {
                    HStack(spacing: 12) {
                        Text(F.date(f.date)).monospacedDigit().foregroundStyle(.secondary).frame(width: 100, alignment: .leading)
                        Text(f.form).fontWeight(.semibold).frame(width: 64, alignment: .leading)
                        Text(f.description == f.form ? "" : f.description).foregroundStyle(.secondary).lineLimit(1)
                        Spacer()
                        Image(systemName: "arrow.up.right.square").foregroundStyle(.tertiary)
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
            Text("Opens the filing on sec.gov in your browser.").font(.caption).foregroundStyle(.tertiary)
        }
    }

    private func calculatorsCard(_ r: StockReport) -> some View {
        let price = r.quote["price"] ?? nil, d = r.dividends, beta = r.risk["beta5y"] ?? nil, vol = r.risk["vol1y"] ?? nil
        let r5 = r.returns.first { $0.key == "5Y" }?.stock
        let p = price.map { Format.plain($0, maxDecimals: 4) } ?? ""
        func pf(_ x: Double?) -> String? { x.map { Format.plain($0 * 100, maxDecimals: 2) } }
        return Card(title: "Use these numbers in a calculator") {
            HStack {
                Button("Position gain/loss") { state.openCalculator("position_pl", setting: ["price": p]) }
                Button("Position sizing") { state.openCalculator("position_size", setting: ["price": p]) }
                if let t = d["ttm"] ?? nil, t > 0 { Button("Dividend discount model") { state.openCalculator("ddm", setting: ["d0": Format.plain(t, maxDecimals: 4), "price": p]) } }
                if let y = d["yield"] ?? nil, y > 0 {
                    Button("Dividend income growth") { state.openCalculator("dividend_income", setting: ["y": pf(y)!, "g": pf(d["growth5"] ?? nil)].compactMapValues { $0 }) }
                }
                if let beta { Button("CAPM expected return") { state.openCalculator("capm", setting: ["b": Format.plain(beta, maxDecimals: 3)]) } }
                if let r5, let vol { Button("Sharpe ratio") { state.openCalculator("sharpe", setting: ["r": pf(r5)!, "sd": pf(vol)!]) } }
            }
            Text("Fills in what's known from this stock (price, dividend, beta, past return and volatility). Past growth and returns are filled in only as a starting point; change them to your own assumptions.")
                .font(.caption).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

enum StockMathShift {
    static func back(_ day: Int, months: Int) -> Int {
        let (y, m, d) = StockMath.ymd(day)
        let t = y * 12 + (m - 1) - months
        let ny = Int((Double(t) / 12).rounded(.down)), nm = t - ny * 12 + 1
        let last = StockMath.days(nm == 12 ? ny + 1 : ny, nm == 12 ? 1 : nm + 1, 1) - StockMath.days(ny, nm, 1)
        return StockMath.days(ny, nm, min(d, last))
    }
}
