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

/// Advisor home: one large composite score, what changed, the three horizons, what moved the score,
/// and a prominent way into the client version. Mirrors advisorHome() in web/app.js.
struct MarketBriefView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var roro: RoRoStore

    private let spans = ["Tactical": "days to weeks", "Intermediate": "1–3 months", "Strategic": "3–12 months"]

    static func word(_ v: Double) -> String { v.isNaN ? "" : (v >= 20 ? "Offense" : (v <= -20 ? "Defense" : "Neutral")) }

    /// "2026-11-18" → "Nov 18".
    static func shortDay(_ iso: String?) -> String? {
        guard let iso, let d = DayMath.parse(iso) else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US"); f.timeZone = TimeZone(identifier: "UTC"); f.dateFormat = "MMM d"
        return f.string(from: DayMath.date(d))
    }

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                content(narrow: geo.size.width < 760)
                    .padding(.horizontal, geo.size.width < 760 ? 16 : 32).padding(.vertical, 28)
                    .frame(maxWidth: 1040, alignment: .leading)
                    .frame(maxWidth: .infinity)
            }
        }
        .background(Color.wealthPaper)
        .navigationTitle("Market Brief")
        .navigationSubtitle("Advisor Mode")
        .toolbar {
            Button { roro.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }.disabled(roro.running)
        }
        .onAppear { roro.refreshIfStale() }
    }

    @ViewBuilder private func content(narrow: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            let model = roro.model.flatMap { ($0["horizons"]?.items ?? []).isEmpty ? nil : $0 }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) { title; Spacer(minLength: 16); if let model { asOf(model) } }
                VStack(alignment: .leading, spacing: 8) { title; if let model { asOf(model) } }
            }
            if let m = model {
                brief(m, narrow: narrow)
            } else if roro.running {
                ProgressView(value: Double(roro.progress.0), total: Double(max(roro.progress.1, 1))) { Text("Downloading market data…").foregroundStyle(.secondary) }
                    .padding(.top, 24)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text(roro.error ?? "The RoRo reading hasn't been downloaded yet.").foregroundStyle(.secondary)
                    Button("Download now") { roro.refresh() }
                }
                .padding(.top, 24)
            }
            Text("Educational calculations. Not investment, tax or legal advice. Independent application; not affiliated with or endorsed by Morgan Stanley.")
                .font(.system(size: 13.5)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 680, alignment: .leading)
                .padding(.top, 14).frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
                .padding(.top, 24)
        }
    }

    private var title: some View { Text("Market Brief").font(.wealthSerif(30)).foregroundStyle(Color.wealthInk) }

    private func asOf(_ m: JSONValue) -> some View {
        let s = roro.status
        return HStack(spacing: 10) {
            Text("RoRo Composite · as of \(m["asof"]?.str ?? "—")").font(.system(size: 14)).foregroundStyle(.secondary)
            Text(s.label.uppercased()).font(.caption.weight(.bold))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(s.color.opacity(0.14), in: Capsule()).foregroundStyle(s.color)
                .help(s.detail)
        }
    }

    @ViewBuilder private func brief(_ m: JSONValue, narrow: Bool) -> some View {
        let p = m["posture"] ?? .null, band = p["band"]?.str ?? "—"
        let value = p["value"]?.num ?? .nan
        let since = Self.shortDay(p["prev_date"]?.str) ?? "the last reading"
        // The two buckets whose scores changed most since the previous reading.
        let movers = (m["buckets"]?.items ?? []).filter { !($0["wow"]?.num ?? .nan).isNaN }
            .sorted { abs($0["wow"]?.num ?? 0) > abs($1["wow"]?.num ?? 0) }.prefix(2)

        // Score
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .lastTextBaseline, spacing: 36) {
                Text(RoRoStyle.signed(value)).font(.system(size: narrow ? 76 : 96, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(RoRoStyle.bandColor(band))
                    .accessibilityLabel("RoRo Composite \(RoRoStyle.signed(value)), \(band)")
                VStack(alignment: .leading, spacing: 6) {
                    Text(band.uppercased()).font(.system(size: 15, weight: .bold)).tracking(1.2).foregroundStyle(RoRoStyle.bandColor(band))
                    if let d = p["delta"]?.double {
                        (Text(RoRoStyle.signed(d)).fontWeight(.semibold).foregroundColor(Color.wealthInk)
                         + Text(" since \(since)") + Text(p["prev"]?.double.map { " (was \(RoRoStyle.signed($0)))" } ?? ""))
                            .font(.system(size: 17)).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                .padding(.bottom, 6)
            }
            ScoreMeter(value: value)
        }
        .padding(.top, 20)
        .overlay(alignment: .top) { Rectangle().fill(Color.wealthInk).frame(height: 1) }
        .padding(.top, 24)

        // Horizons
        let horizons = m["horizons"]?.items ?? []
        Group {
            if narrow {
                VStack(alignment: .leading, spacing: 0) { ForEach(Array(horizons.enumerated()), id: \.offset) { i, h in horizon(h, first: i == 0, narrow: true) } }
            } else {
                HStack(alignment: .top, spacing: 0) { ForEach(Array(horizons.enumerated()), id: \.offset) { i, h in horizon(h, first: i == 0, narrow: false) } }
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .overlay(alignment: .top) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
        .padding(.top, 22)

        // Lower: what moved, and the client version
        let moved = VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: "What moved the score")
            VStack(alignment: .leading, spacing: 0) {
                if movers.isEmpty {
                    Text("No bucket changes are available for this reading.").foregroundStyle(.secondary).padding(.vertical, 12)
                }
                ForEach(Array(movers.enumerated()), id: \.offset) { _, b in
                    let w = b["wow"]?.num ?? 0
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(b["name"]?.str ?? "").font(.system(size: 15, weight: .semibold))
                            Text("Bucket score \(w < 0 ? "fell" : (w > 0 ? "rose" : "held")) to \(RoRoStyle.signed(b["score"]?.num ?? .nan)) since \(since).")
                                .font(.system(size: 14)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        Text(RoRoStyle.signed(w)).font(.system(size: 20, weight: .semibold)).monospacedDigit()
                            .foregroundStyle(w > 0 ? Color.wealthUp : (w < 0 ? Color.wealthDown : Color.wealthInk))
                    }
                    .padding(.vertical, 12)
                    .overlay(alignment: .bottom) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
                }
            }
            .overlay(alignment: .top) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
            Button("All factors, history and methodology") { state.selection = .roro }
                .buttonStyle(.plain).font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.wealthAccentText)
        }
        let client = VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: "For the client")
            Text("The same reading in plain language, without scores or jargon.").foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button { state.showClient(.market) } label: {
                HStack(spacing: 8) { Text("Show client version"); Text("→") }
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 18).padding(.vertical, 11)
                    .background(Color.wealthAccent, in: RoundedRectangle(cornerRadius: 5))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Open the plain-language market view in Client Mode")
            Button("Treasury yields & quotes") { state.selection = .markets }
                .buttonStyle(.plain).font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.wealthAccentText)
        }
        .padding(.top, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
        Group {
            if narrow {
                VStack(alignment: .leading, spacing: 28) { moved; client }
            } else {
                HStack(alignment: .top, spacing: 48) { moved.frame(maxWidth: .infinity, alignment: .leading); client.frame(width: 360, alignment: .leading) }
            }
        }
        .padding(.top, 30)

        Text("Scale −100 (risk-off) to +100 (risk-on); Offense above +20, Defense below −20. Bucket changes are the change in each bucket's own score; buckets are weighted differently in each horizon. A hand-calibrated model of current conditions, not a forecast of returns. \(roro.status.detail)")
            .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            .padding(.top, 22)
    }

    private func horizon(_ h: JSONValue, first: Bool, narrow: Bool) -> some View {
        let v = h["value"]?.num ?? .nan, label = h["label"]?.str ?? ""
        return VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.system(size: 15, weight: .semibold))
            Text(spans[label] ?? (h["span"]?.str ?? "")).font(.system(size: 13)).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(RoRoStyle.signed(v)).font(.system(size: 30, weight: .semibold)).monospacedDigit()
                Text(Self.word(v).uppercased()).font(.system(size: 13, weight: .semibold)).tracking(0.8)
            }
            .foregroundStyle(RoRoStyle.color(v))
            .padding(.top, 6)
        }
        .padding(.vertical, 14)
        .padding(.leading, first || narrow ? 0 : 20).padding(.trailing, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: narrow ? .top : .leading) {
            if !first { Rectangle().fill(Color.wealthRule).frame(width: narrow ? nil : 1, height: narrow ? 1 : nil) }
        }
    }
}

/// A −100…+100 meter with the ±20 Offense / Defense zones; stretches to the page width.
/// Mirrors scoreMeter() in web/app.js.
struct ScoreMeter: View {
    let value: Double
    private let ticks: [Double] = [-100, -50, -20, 0, 20, 50, 100]

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let x = { (s: Double) in CGFloat((min(max(s, -100), 100) + 100) / 200) * w }
            ZStack {
                Rectangle().fill(Color.primary.opacity(0.12)).frame(width: x(-20), height: 6).position(x: x(-20) / 2, y: 13)
                Rectangle().fill(Color.wealthAmber.opacity(0.22)).frame(width: x(20) - x(-20), height: 6).position(x: (x(-20) + x(20)) / 2, y: 13)
                Rectangle().fill(Color.wealthAccent.opacity(0.18)).frame(width: w - x(20), height: 6).position(x: (x(20) + w) / 2, y: 13)
                if !value.isNaN {
                    Rectangle().fill(Color.wealthInk).frame(width: 4, height: 26).position(x: min(max(x(value), 2), w - 2), y: 13)
                }
                ForEach(ticks, id: \.self) { t in
                    Text(t == 0 ? "0" : RoRoStyle.signed(t)).font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
                        .frame(width: 60, alignment: t == -100 ? .leading : (t == 100 ? .trailing : .center))
                        .position(x: t == -100 ? x(t) + 30 : (t == 100 ? x(t) - 30 : x(t)), y: 38)
                }
            }
            .frame(width: w, height: 46)
        }
        .frame(height: 46)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Score \(RoRoStyle.signed(value)) on a scale from −100 to +100")
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
