import SwiftUI
import WealthCore

/// Advisor Mode's flow: Market Brief → Stock research / Calculators → Present to client.
/// Mirrors the web version (advisorHome, calculatorsPage, PRESENT in web/app.js).
enum AdvisorFlow {
    /// The calculators an advisor reaches for most in a meeting; first on the Calculators page.
    static let frequent = ["retirement_timeline", "retirement_mc", "portfolio_stress", "fee_drag", "rmd", "income_tax", "roth_conversion", "ltcg_tax"]
    /// Shown last and folded away on the Calculators page (still searchable).
    static let tucked: Set<String> = ["Everyday math"]
    /// Advisor calculators whose inputs carry straight into a Client Mode tool (same field names and units).
    static let present: [String: (tool: ClientTool, key: String)] = [
        "retirement_timeline": (.retirement, "client.retirement"),
        "retirement_mc": (.retirement, "client.retirement"),
        "portfolio_stress": (.risk, "client.risk"),
        "growth_schedule": (.growth, "client.growth"),
    ]
}

extension AppState {
    /// Opens the matching Client Mode tool with the numbers typed in this calculator.
    func presentToClient(_ calcID: String) {
        guard let p = AdvisorFlow.present[calcID] else { return }
        for (k, v) in session.working[calcID] ?? [:] where !v.trimmingCharacters(in: .whitespaces).isEmpty {
            session.working[p.key, default: [:]][k] = v
        }
        showClient(p.tool)
    }
}

struct MarketBriefView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var roro: RoRoStore

    private let names = ["Tactical": "Tactical · days to weeks", "Intermediate": "Intermediate · 1–3 months", "Strategic": "Strategic · 3–12 months"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Market Brief").font(.wealthSerif(30))
                    Text("Where markets stand today, then the tools for the conversation.").foregroundStyle(.secondary)
                }
                brief
                VStack(spacing: 0) {
                    Divider()
                    HomeTile(symbol: "magnifyingglass", title: "Stock research", text: "Look up one company: price, risk, fundamentals, filings") { state.selection = .stock }
                    HomeTile(symbol: "square.grid.2x2", title: "Calculators", text: "\(state.calculators.count) calculators, most-used first") { state.selection = .calculators }
                    HomeTile(symbol: "person.2", title: "Client Mode", text: "Plain-language tools to show a client") { state.showClient(nil) }
                }
                Text("Educational calculations. Not investment, tax or legal advice. Independent application; not affiliated with or endorsed by Morgan Stanley.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(24)
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Market Brief")
        .navigationSubtitle("Advisor Mode")
        .toolbar {
            Button { roro.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }.disabled(roro.running)
        }
        .onAppear { roro.refreshIfStale() }
    }

    @ViewBuilder private var brief: some View {
        if let m = roro.model, !(m["horizons"]?.items ?? []).isEmpty {
            let p = m["posture"] ?? .null, band = p["band"]?.str ?? "—", s = roro.status
            Card(title: "RoRo Composite · overall reading", trailing: AnyView(
                VStack(alignment: .trailing, spacing: 2) {
                    Text(s.label.uppercased()).font(.caption.weight(.bold)).foregroundStyle(s.color)
                    Text("As of \(m["asof"]?.str ?? "—")").font(.caption).foregroundStyle(.secondary)
                })) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(band).font(.system(size: 40, weight: .bold)).foregroundStyle(RoRoStyle.bandColor(band))
                    Text(RoRoStyle.signed(p["value"]?.num ?? .nan)).font(.wealthSerif(30)).monospacedDigit()
                    Text("\(RoRoStyle.signed(p["delta"]?.num ?? .nan)) since \(p["prev_date"]?.str ?? "the last run")").font(.callout).foregroundStyle(.secondary)
                }
                ScoreBar(value: p["value"]?.num ?? .nan, height: 12)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                    ForEach(Array((m["horizons"]?.items ?? []).enumerated()), id: \.offset) { _, h in
                        let v = h["value"]?.num ?? .nan
                        VStack(alignment: .leading, spacing: 6) {
                            Text(names[h["label"]?.str ?? ""] ?? (h["label"]?.str ?? "")).font(.callout).foregroundStyle(.secondary)
                            HStack(alignment: .firstTextBaseline) {
                                Text(RoRoStyle.signed(v)).font(.wealthSerif(22)).monospacedDigit().foregroundStyle(RoRoStyle.color(v))
                                Spacer()
                                Text(v.isNaN ? "" : (v >= 20 ? "Offense" : (v <= -20 ? "Defense" : "Neutral"))).font(.caption).foregroundStyle(.secondary)
                            }
                            ScoreBar(value: v)
                        }
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                HStack(spacing: 16) {
                    Button("Factors, history and methodology") { state.selection = .roro }
                    Button("Show the client version") { state.showClient(.market) }.buttonStyle(.plain).foregroundStyle(Color.wealthAccent)
                    Button("Treasury yields & quotes") { state.selection = .markets }.buttonStyle(.plain).foregroundStyle(Color.wealthAccent)
                }
                Text("Scale −100 (risk-off) to +100 (risk-on); Offense above +20, Defense below −20. A hand-calibrated model of current conditions, not a forecast of returns.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        } else if roro.running {
            Card(title: "Market Brief") {
                ProgressView(value: Double(roro.progress.0), total: Double(max(roro.progress.1, 1))) { Text("Downloading market data…").foregroundStyle(.secondary) }
            }
        } else {
            Card(title: "Market Brief") {
                Text(roro.error ?? "The RoRo reading hasn't been downloaded yet.").foregroundStyle(.secondary)
                Button("Download now") { roro.refresh() }
            }
        }
    }
}

struct CalculatorsView: View {
    @EnvironmentObject var state: AppState
    @State private var query = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Calculators").font(.wealthSerif(30))
                    Text("Every calculator opens blank; type your own numbers. Formulas, assumptions and sources are on each one. The people icon means it can open the matching Client Mode tool with the same numbers (Present to client).")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search all \(state.calculators.count) calculators", text: $query).textFieldStyle(.plain)
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(Color.wealthCard, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12)))
                .frame(maxWidth: 520)

                let q = query.trimmingCharacters(in: .whitespaces)
                if !q.isEmpty {
                    let hits = CatalogLoader.search(q, in: state.calculators)
                    section(hits.count == 1 ? "1 match" : "\(hits.count) matches", hits)
                    if hits.isEmpty { Text("No calculator matches that. Try a shorter word.").foregroundStyle(.secondary) }
                } else {
                    section("Frequently used", AdvisorFlow.frequent.compactMap { state.calculator($0) })
                    let favs = state.prefs.favorites.compactMap { state.calculator($0) }
                    if !favs.isEmpty { section("Favorites", favs) }
                    ForEach(state.categories.filter { !AdvisorFlow.tucked.contains($0) }, id: \.self) { cat in
                        section(cat, state.calculators.filter { $0.category == cat })
                    }
                    ForEach(state.categories.filter { AdvisorFlow.tucked.contains($0) }, id: \.self) { cat in
                        let list = state.calculators.filter { $0.category == cat }
                        DisclosureGroup { grid(list).padding(.top, 8) } label: { Text("\(cat) (\(list.count))").font(.headline) }
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Calculators")
        .navigationSubtitle("Advisor Mode")
    }

    private func section(_ title: String, _ list: [Calculator]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            grid(list)
        }
    }

    private func grid(_ list: [Calculator]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(list) { c in
                Button { state.selection = .calc(c.id) } label: {
                    HStack {
                        Text(c.name).lineLimit(1)
                        Spacer()
                        if AdvisorFlow.present[c.id] != nil { Image(systemName: "person.2").font(.caption).foregroundStyle(.tertiary).help("Has a Client Mode view") }
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(c.summary)
            }
        }
    }
}

/// Optional Client Mode inputs, folded away; starts open when any of them has a value.
struct MoreAssumptions<Content: View>: View {
    @EnvironmentObject var state: AppState
    let key: String
    let ids: [String]
    var note: String? = nil
    @ViewBuilder let content: Content
    @State private var open: Bool?

    var body: some View {
        let hasValue = ids.contains { !state.clientRaw(key, $0).trimmingCharacters(in: .whitespaces).isEmpty }
        DisclosureGroup(isExpanded: Binding(get: { open ?? hasValue }, set: { open = $0 })) {
            VStack(alignment: .leading, spacing: 12) {
                if let note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                content
            }.padding(.top, 8)
        } label: {
            Text("More assumptions").font(.subheadline.weight(.semibold))
        }
    }
}
