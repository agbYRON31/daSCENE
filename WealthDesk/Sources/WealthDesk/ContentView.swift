import AppKit
import SwiftUI
import WealthCore

/// Top level: start screen, then Advisor Mode or Client Mode.
struct RootView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        Group {
            if let error = state.loadError {
                ContentUnavailable(title: "Wealth Desk couldn't start", message: error, symbol: "exclamationmark.triangle")
            } else {
                switch state.screen {
                case .start: StartView()
                case .advisor: AdvisorView()
                case .client: ClientModeView()
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let toast = state.toast {
                Text(toast)
                    .font(.callout)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 16)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: state.toast)
        .background(WindowAccessor(pinned: state.prefs.pinned))
    }
}

/// Segmented Advisor / Client switch shown in both modes.
struct ModeSwitch: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        Picker("Mode", selection: Binding(get: { state.screen == .client ? Screen.client : Screen.advisor },
                                          set: { state.enter($0) })) {
            Text("Advisor").tag(Screen.advisor)
            Text("Client").tag(Screen.client)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(width: 170)
        .help("Advisor Mode: the full library with formulas and methodology. Client Mode: simple, visual tools.")
    }
}

// MARK: - Start screen

struct StartView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        // Centered when there is room; scrolls when the window is small.
        GeometryReader { geo in
            ScrollView {
                content(compact: geo.size.width < 720)
                    .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
        }
        .background(Color.wealthPaper)
    }

    private func content(compact: Bool) -> some View {
        VStack(spacing: compact ? 18 : 28) {
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 6) {
                Text("See how financial decisions play out").font(.system(size: compact ? 24 : 28, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text("Type in any numbers and watch the results update. Nothing is filled in for you, and nothing you type is saved or sent (Stock research sends only the ticker symbol you look up).")
                    .font(.body).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 0) {
                Divider()
                ModeCard(symbol: "person.2", title: "Client Mode",
                         text: "Six plain-language tools with sliders and charts: growth, retirement, risk, decisions, taxes and inflation, and market conditions.",
                         action: "Open Client Mode") { state.showClient(nil) }
                Divider()
                ModeCard(symbol: "square.grid.3x3", title: "Advisor Mode",
                         text: "The full workspace: \(state.calculators.count) calculators with formulas and methodology, market data and the RoRo Composite.",
                         action: "Open Advisor Mode") { state.enter(.advisor) }
                Divider()
            }
            VStack(alignment: .leading, spacing: 6) {
                Label("This session lives in memory only and is cleared when you quit. Saving a scenario or a PDF happens only when you choose to.",
                      systemImage: "lock.shield")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Text("Educational calculations and hypothetical illustrations. Not investment, tax or legal advice. Wealth Desk is an independent application, not affiliated with or endorsed by Morgan Stanley. Don't enter real client information unless your firm has approved this tool for that use.")
                    .font(.caption).foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: 760)
        .padding(compact ? 18 : 32)
    }
}

struct ModeCard: View {
    let symbol: String
    let title: String
    let text: String
    let action: String
    let run: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: run) {
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                Text(title).font(.system(size: 16, weight: .semibold)).frame(width: 130, alignment: .leading)
                Text(text).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Text(action).font(.callout.weight(.medium)).foregroundStyle(Color.wealthAccent)
            }
            .padding(.vertical, 14).padding(.horizontal, 4)
            .background(hover ? Color.primary.opacity(0.04) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// MARK: - Advisor Mode

struct AdvisorView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 230, ideal: 270, max: 360)
        } detail: {
            Group {
                switch state.selection {
                case .calc(let id)?:
                    if let calc = state.calculator(id) {
                        CalculatorView(calc: calc).id(calc.id)
                    } else {
                        ContentUnavailable(title: "Not found", message: "That calculator isn't in this catalog.", symbol: "questionmark")
                    }
                case .calculator?: CalculatorPadView()
                case .markets?: MarketsView()
                case .stock?: StockView()
                case .calculators?: CalculatorsView()
                case .scenarios?: ScenariosView()
                case .history?: HistoryView()
                case .roro?: RoRoView()
                case .home?, nil: MarketBriefView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.wealthPaper)
            .toolbar {
                ToolbarItem(placement: .navigation) { ModeSwitch() }
            }
        }
        .searchable(text: $state.search, placement: .sidebar, prompt: "Search calculators")
    }
}

struct AdvisorHomeView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Advisor workspace").font(.wealthSerif(30))
                    Text("Pick a tool. Every calculator opens blank; type your own numbers and results update as you go. Formulas, assumptions and sources are under “Details & Excel” on each one.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 14)], spacing: 14) {
                    HomeTile(symbol: "gauge.medium", title: "RoRo Composite", text: "Market risk conditions across 37 factors") { state.selection = .roro }
                    HomeTile(symbol: "chart.xyaxis.line", title: "Markets", text: "Treasury yield curve and a quote watchlist") { state.selection = .markets }
                    HomeTile(symbol: "magnifyingglass", title: "Stock research", text: "One company: price, risk, fundamentals, filings") { state.selection = .stock }
                    HomeTile(symbol: "plusminus.circle", title: "Calculator", text: "Basic and scientific, with a history tape") { state.selection = .calculator }
                    HomeTile(symbol: "person.2", title: "Client Mode", text: "Six simple, visual tools for a conversation") { state.showClient(nil) }
                }
                ForEach(state.categories, id: \.self) { cat in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(cat).font(.headline)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 8)], alignment: .leading, spacing: 8) {
                            ForEach(state.calculators.filter { $0.category == cat }) { c in
                                Button { state.selection = .calc(c.id) } label: {
                                    HStack {
                                        Text(c.name).lineLimit(1)
                                        Spacer()
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
                Text("Educational calculations. Not investment, tax or legal advice. Independent application; not affiliated with or endorsed by Morgan Stanley.")
                    .font(.caption).foregroundStyle(.tertiary)
            }
            .padding(24)
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Wealth Desk")
        .navigationSubtitle("Advisor Mode")
    }
}

struct HomeTile: View {
    let symbol: String
    let title: String
    let text: String
    let run: () -> Void

    var body: some View {
        Button(action: run) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 14) {
                    Text(title).fontWeight(.semibold).frame(width: 140, alignment: .leading)
                    Text(text).foregroundStyle(.secondary).lineLimit(2)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
                .padding(.vertical, 10)
                Divider()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct SidebarView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        List(selection: $state.selection) {
            if !state.search.isEmpty {
                let results = CatalogLoader.search(state.search, in: state.calculators)
                let pages = Self.pages.filter { ($0.title + " " + $0.words).localizedCaseInsensitiveContains(state.search.trimmingCharacters(in: .whitespaces)) }
                Section("Results") {
                    if results.isEmpty && pages.isEmpty {
                        Text("No matches").foregroundStyle(.secondary)
                    }
                    ForEach(pages, id: \.title) { p in Label(p.title, systemImage: p.symbol).tag(p.item) }
                    ForEach(results) { row($0) }
                }
            } else {
                // Four destinations; the full calculator library is on the Calculators page and in search.
                Section {
                    Label("Market Brief", systemImage: "gauge.medium").tag(SidebarItem.home)
                    Label("RoRo Composite", systemImage: "gauge.with.dots.needle.67percent").tag(SidebarItem.roro)
                    Label("Stock research", systemImage: "magnifyingglass").tag(SidebarItem.stock)
                    Label("Calculators", systemImage: "square.grid.2x2").tag(SidebarItem.calculators)
                    Button { state.showClient(nil) } label: { Label("Client Mode", systemImage: "person.2") }.buttonStyle(.plain)
                }
                Section("Tools") {
                    Label("Treasury yields & quotes", systemImage: "chart.xyaxis.line").tag(SidebarItem.markets)
                    Label("Calculator", systemImage: "plusminus.circle").tag(SidebarItem.calculator)
                    Label("Session scenarios", systemImage: "tray.full")
                        .badge(state.session.scenarios.count)
                        .tag(SidebarItem.scenarios)
                    Label("Session history", systemImage: "clock.arrow.circlepath").tag(SidebarItem.history)
                }
                let favorites = state.prefs.favorites.compactMap { state.calculator($0) }
                if !favorites.isEmpty {
                    Section("Favorites") { ForEach(favorites) { row($0) } }
                }
                if case .calc(let id)? = state.selection, !state.prefs.favorites.contains(id), let c = state.calculator(id) {
                    Section("Open") { row(c) }
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            Text("Inputs stay in memory for this session only. Not investment, tax or legal advice.")
                .font(.caption2).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14).padding(.vertical, 8)
        }
    }

    /// Pages the sidebar search finds by name or keyword, alongside calculators.
    static let pages: [(title: String, symbol: String, item: SidebarItem, words: String)] = [
        ("Market Brief", "gauge.medium", .home, "roro market brief risk on risk off regime overview"),
        ("RoRo Composite", "gauge.with.dots.needle.67percent", .roro, "roro risk on off composite factors regime posture market"),
        ("Stock research", "magnifyingglass", .stock, "stock ticker equity company fundamentals sec filings"),
        ("Calculators", "square.grid.2x2", .calculators, "calculator library formulas"),
        ("Treasury yields & quotes", "chart.xyaxis.line", .markets, "treasury yields curve bonds rates quotes watchlist markets"),
        ("Calculator", "plusminus.circle", .calculator, "calculator scientific"),
        ("Session scenarios", "tray.full", .scenarios, "scenarios saved"),
        ("Session history", "clock.arrow.circlepath", .history, "history"),
    ]

    func row(_ c: Calculator) -> some View {
        HStack {
            Text(c.name).lineLimit(1)
            Spacer()
            if !c.acronym.isEmpty {
                Text(c.acronym).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            }
        }
        .tag(SidebarItem.calc(c.id))
    }
}

struct ContentUnavailable: View {
    let title: String
    let message: String
    let symbol: String
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 34)).foregroundStyle(.secondary)
            Text(title).font(.title3.weight(.semibold))
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Applies the "keep on top" preference to the hosting NSWindow.
struct WindowAccessor: NSViewRepresentable {
    let pinned: Bool

    func makeNSView(context: Context) -> NSView { NSView() }

    func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            window.level = pinned ? .floating : .normal
            if pinned {
                window.collectionBehavior.insert([.canJoinAllSpaces, .fullScreenAuxiliary])
            } else {
                window.collectionBehavior.remove([.canJoinAllSpaces, .fullScreenAuxiliary])
            }
        }
    }
}
