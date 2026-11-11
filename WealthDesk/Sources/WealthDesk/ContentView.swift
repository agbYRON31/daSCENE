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
        VStack(spacing: 28) {
            Spacer(minLength: 20)
            VStack(spacing: 8) {
                Text("WEALTH DESK").font(.system(size: 13, weight: .bold)).tracking(3).foregroundStyle(Color.wealthAccent)
                Text("See how financial decisions play out").font(.system(size: 34, weight: .semibold, design: .serif))
                Text("Type in any numbers and watch the results update. Nothing is filled in for you, and nothing you type is saved or sent.")
                    .font(.title3).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 620)
            }
            HStack(spacing: 20) {
                ModeCard(symbol: "person.2", title: "Client Mode",
                         text: "Five plain-language tools with sliders and charts: growth, retirement, risk, decisions, taxes and inflation.",
                         action: "Open Client Mode") { state.showClient(nil) }
                ModeCard(symbol: "square.grid.3x3", title: "Advisor Mode",
                         text: "The full workspace: \(state.calculators.count) calculators with formulas and methodology, market data and the RoRo Composite.",
                         action: "Open Advisor Mode") { state.enter(.advisor) }
            }
            .frame(maxWidth: 760)
            VStack(spacing: 6) {
                Label("This session lives in memory only and is cleared when you quit. Saving a scenario or a PDF happens only when you choose to.",
                      systemImage: "lock.shield")
                    .font(.callout).foregroundStyle(.secondary)
                Text("Educational calculations and hypothetical illustrations. Not investment, tax or legal advice. Wealth Desk is an independent application, not affiliated with or endorsed by Morgan Stanley. Don't enter real client information unless your firm has approved this tool for that use.")
                    .font(.caption).foregroundStyle(.tertiary).multilineTextAlignment(.center).frame(maxWidth: 700)
            }
            Spacer(minLength: 20)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
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
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: symbol).font(.system(size: 26)).foregroundStyle(Color.wealthAccent)
                Text(title).font(.title2.weight(.semibold))
                Text(text).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                HStack { Text(action).fontWeight(.semibold); Image(systemName: "arrow.right") }
                    .foregroundStyle(Color.wealthAccent)
            }
            .padding(24)
            .frame(maxWidth: .infinity, minHeight: 210, alignment: .topLeading)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(hover ? Color.wealthAccent : Color.primary.opacity(0.1), lineWidth: hover ? 1.5 : 1))
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
                case .roro?: RoRoView()
                case .scenarios?: ScenariosView()
                case .history?: HistoryView()
                case .home?, nil: AdvisorHomeView()
                }
            }
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
                    Text("Advisor workspace").font(.largeTitle.weight(.semibold))
                    Text("Pick a tool. Every calculator opens blank; type your own numbers and results update as you go. Formulas, assumptions and sources are under “Details & Excel” on each one.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 14)], spacing: 14) {
                    HomeTile(symbol: "gauge.medium", title: "RoRo Composite", text: "Market risk conditions across 37 factors") { state.selection = .roro }
                    HomeTile(symbol: "chart.xyaxis.line", title: "Markets", text: "Treasury yield curve and a quote watchlist") { state.selection = .markets }
                    HomeTile(symbol: "plusminus.circle", title: "Calculator", text: "Basic and scientific, with a history tape") { state.selection = .calculator }
                    HomeTile(symbol: "person.2", title: "Client Mode", text: "Five simple, visual tools for a conversation") { state.showClient(nil) }
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
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: symbol).font(.title2).foregroundStyle(Color.wealthAccent).frame(width: 30)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.headline)
                    Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 74, alignment: .topLeading)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.08)))
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
                Section("Results") {
                    if results.isEmpty {
                        Text("No matches").foregroundStyle(.secondary)
                    }
                    ForEach(results) { row($0) }
                }
            } else {
                Section {
                    Label("Home", systemImage: "house").tag(SidebarItem.home)
                    Label("RoRo Composite", systemImage: "gauge.medium").tag(SidebarItem.roro)
                    Label("Markets", systemImage: "chart.xyaxis.line").tag(SidebarItem.markets)
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
                Section("Common") {
                    ForEach(state.calculators.filter(\.common)) { row($0) }
                }
                ForEach(state.categories, id: \.self) { cat in
                    Section(cat) {
                        ForEach(state.calculators.filter { $0.category == cat }) { row($0) }
                    }
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
