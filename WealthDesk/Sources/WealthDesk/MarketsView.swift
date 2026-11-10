import Charts
import SwiftUI
import WealthCore

@MainActor
final class MarketStore: ObservableObject {
    @Published var curve: YieldCurve?
    @Published var curveError: String?
    @Published var quotes: [String: Quote] = [:]
    @Published var quoteErrors: [String: String] = [:]
    @Published var loading = false
    @Published var lastRefresh: Date?

    private let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 15
        c.httpAdditionalHeaders = ["User-Agent": "Mozilla/5.0 (Macintosh) WealthDesk"]
        return URLSession(configuration: c)
    }()

    /// Starts a refresh that isn't tied to any view, so leaving the page doesn't cancel it.
    func refresh(symbols: [String]) {
        guard !loading else { return }
        loading = true
        Task {
            async let curveTask: Void = loadCurve()
            async let quotesTask: Void = loadQuotes(symbols)
            _ = await (curveTask, quotesTask)
            loading = false
            if curve != nil || !quotes.isEmpty { lastRefresh = Date() }
        }
    }

    /// Refreshes when nothing has loaded yet or the data is more than five minutes old.
    func refreshIfStale(symbols: [String]) {
        if let last = lastRefresh, Date().timeIntervalSince(last) < 300, curve != nil { return }
        refresh(symbols: symbols)
    }

    static func isCancellation(_ error: Error) -> Bool {
        (error as? URLError)?.code == .cancelled || error is CancellationError
    }

    func loadCurve() async {
        let year = Calendar.current.component(.year, from: Date())
        // Early January can have no rows yet for the new year; fall back to last year.
        for y in [year, year - 1] {
            do {
                let (data, _) = try await session.data(from: MarketParsers.treasuryURL(year: y))
                if let c = MarketParsers.parseTreasuryCSV(String(decoding: data, as: UTF8.self)) {
                    curve = c
                    curveError = nil
                    return
                }
            } catch {
                if !Self.isCancellation(error) {
                    curveError = "Couldn't reach Treasury.gov: \(error.localizedDescription)"
                }
                return
            }
        }
        curveError = "Treasury.gov returned no yield data."
    }

    func loadQuotes(_ symbols: [String]) async {
        await withTaskGroup(of: (String, Result<Quote, Error>).self) { group in
            for s in symbols {
                group.addTask { [session] in
                    guard let url = MarketParsers.quoteURL(symbol: s) else {
                        return (s, .failure(EvalError.message("Not a valid symbol.")))
                    }
                    do {
                        let (data, _) = try await session.data(from: url)
                        return (s, .success(try MarketParsers.parseQuote(data)))
                    } catch {
                        return (s, .failure(error))
                    }
                }
            }
            for await (s, r) in group {
                switch r {
                case .success(let q): quotes[s] = q; quoteErrors[s] = nil
                case .failure(let e):
                    if !Self.isCancellation(e) { quoteErrors[s] = e.localizedDescription }
                }
            }
        }
    }

    func load(symbol: String) async { await loadQuotes([symbol]) }
}

struct MarketsView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var market: MarketStore
    @State private var newSymbol = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Markets").font(.title.weight(.semibold))
                    Text("Treasury yields from Treasury.gov (official, end of day). Quotes are from Yahoo Finance's unofficial feed and may be delayed or stop working. Data is fetched only when you open this page or press Refresh; the symbols you add are sent to Yahoo.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                curveCard
                watchlistCard
            }
            .padding(24)
            .frame(maxWidth: 860, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Markets")
        .navigationSubtitle(market.lastRefresh.map { "Updated \($0.formatted(date: .omitted, time: .shortened))" } ?? "")
        .toolbar {
            Button {
                market.refresh(symbols: state.workspace.watchlist)
            } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                .keyboardShortcut("r")
                .disabled(market.loading)
        }
        .onAppear { market.refreshIfStale(symbols: state.workspace.watchlist) }
    }

    // MARK: Yield curve

    private var curveCard: some View {
        Card(title: "Treasury yield curve",
             trailing: market.curve.map { AnyView(Text("As of \($0.date)").font(.callout).foregroundStyle(.secondary)) }) {
            if let curve = market.curve {
                Chart(curve.points) { p in
                    LineMark(x: .value("Maturity", p.label), y: .value("Yield", p.rate * 100))
                        .interpolationMethod(.monotone)
                        .foregroundStyle(Color.wealthAccent)
                    PointMark(x: .value("Maturity", p.label), y: .value("Yield", p.rate * 100))
                        .foregroundStyle(Color.wealthAccent)
                }
                .chartYScale(domain: .automatic(includesZero: false))
                .chartYAxis { AxisMarks { v in AxisGridLine(); AxisValueLabel { if let d = v.as(Double.self) { Text(String(format: "%.2f%%", d)) } } } }
                .frame(height: 200)

                HStack(spacing: 12) {
                    spreadTile("10Y − 2Y", curve.spread("10 Yr", "2 Yr"))
                    spreadTile("10Y − 3M", curve.spread("10 Yr", "3 Mo"))
                    spreadTile("30Y − 10Y", curve.spread("30 Yr", "10 Yr"))
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(curve.points) { p in yieldTile(p, prior: curve.prior[p.label]) }
                }
                Text("Click a maturity to price a bond at that yield.").font(.caption).foregroundStyle(.tertiary)
            } else if let err = market.curveError {
                Label(err, systemImage: "wifi.exclamationmark").foregroundStyle(.secondary)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
    }

    private func spreadTile(_ title: String, _ v: Double?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            Text(v.map { String(format: "%+.0f bp", $0 * 10000) } ?? "—")
                .font(.system(size: 20, weight: .semibold, design: .rounded)).monospacedDigit()
                .foregroundStyle((v ?? 0) < 0 ? Color.orange : Color.primary)
            if let v, v < 0 { Text("Inverted").font(.caption).foregroundStyle(.orange) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func yieldTile(_ p: YieldPoint, prior: Double?) -> some View {
        Button {
            state.openCalculator("bond_price", setting: ["ytm": Format.plain(p.rate * 100, maxDecimals: 3),
                                                         "years": Format.plain(p.years, maxDecimals: 4),
                                                         "cpn": Format.plain(p.rate * 100, maxDecimals: 3)])
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(p.label).font(.caption).foregroundStyle(.secondary)
                Text(Format.percent(p.rate)).font(.title3.weight(.semibold)).monospacedDigit()
                if let prior {
                    let bp = (p.rate - prior) * 10000
                    Text(String(format: "%+.0f bp", bp)).font(.caption).monospacedDigit()
                        .foregroundStyle(bp > 0 ? Color.red : (bp < 0 ? Color.green : Color.secondary))
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Open Bond price with a \(p.label) yield of \(Format.percent(p.rate))")
    }

    // MARK: Watchlist

    private var watchlistCard: some View {
        Card(title: "Watchlist") {
            HStack {
                TextField("Add a symbol (e.g. VTI, AAPL, ^GSPC)", text: $newSymbol)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 300)
                    .onSubmit(add)
                Button("Add", action: add).disabled(newSymbol.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if state.workspace.watchlist.isEmpty {
                Text("Add a ticker to track it here.").foregroundStyle(.secondary)
            }
            VStack(spacing: 0) {
                ForEach(state.workspace.watchlist, id: \.self) { sym in
                    quoteRow(sym)
                    Divider()
                }
            }
            Text("Click a price to open Position gain/loss with it filled in.").font(.caption).foregroundStyle(.tertiary)
        }
    }

    private func quoteRow(_ sym: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(sym).font(.body.weight(.semibold))
                if let q = market.quotes[sym] {
                    Text(q.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                } else if let e = market.quoteErrors[sym] {
                    Text(e).font(.caption).foregroundStyle(.red).lineLimit(1)
                }
            }
            .frame(width: 260, alignment: .leading)
            Spacer()
            if let q = market.quotes[sym] {
                VStack(alignment: .trailing, spacing: 2) {
                    if let lo = q.low52, let hi = q.high52 {
                        Text("52-wk \(Format.plain(lo, maxDecimals: 2)) – \(Format.plain(hi, maxDecimals: 2))")
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                    if let lo = q.dayLow, let hi = q.dayHigh {
                        Text("Day \(Format.plain(lo, maxDecimals: 2)) – \(Format.plain(hi, maxDecimals: 2))")
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                Button {
                    state.openCalculator("position_pl", setting: ["price": Format.plain(q.price, maxDecimals: 4)])
                } label: {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(Format.plain(q.price, maxDecimals: 2)).font(.title3.weight(.semibold)).monospacedDigit()
                        Text(String(format: "%+.2f (%+.2f%%)", q.change, q.changePercent * 100))
                            .font(.caption).monospacedDigit()
                            .foregroundStyle(q.change >= 0 ? Color.green : Color.red)
                    }
                    .frame(width: 130, alignment: .trailing)
                }
                .buttonStyle(.plain)
                .help("Open Position gain/loss at this price")
            } else if market.loading {
                ProgressView().controlSize(.small)
            }
            Button(role: .destructive) {
                state.workspace.watchlist.removeAll { $0 == sym }
            } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                .buttonStyle(.borderless)
                .help("Remove \(sym)")
        }
        .padding(.vertical, 8)
    }

    private func add() {
        let sym = newSymbol.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !sym.isEmpty, !state.workspace.watchlist.contains(sym) else { newSymbol = ""; return }
        guard MarketParsers.quoteURL(symbol: sym) != nil else { state.flash("That doesn't look like a ticker symbol."); return }
        state.workspace.watchlist.append(sym)
        newSymbol = ""
        Task { await market.load(symbol: sym) }  // short, single request
    }
}
