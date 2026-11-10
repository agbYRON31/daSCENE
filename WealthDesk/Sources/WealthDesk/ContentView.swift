import AppKit
import SwiftUI
import WealthCore

struct ContentView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 230, ideal: 270, max: 360)
        } detail: {
            Group {
                if let error = state.loadError {
                    ContentUnavailable(title: "Catalog missing", message: error, symbol: "exclamationmark.triangle")
                } else {
                    switch state.selection {
                    case .calc(let id)?:
                        if let calc = state.calculator(id) {
                            CalculatorView(calc: calc).id(calc.id)
                        } else {
                            ContentUnavailable(title: "Not found", message: "That calculator isn't in this catalog.", symbol: "questionmark")
                        }
                    case .markets?: MarketsView()
                    case .scenarios?: ScenariosView()
                    case .history?: HistoryView()
                    case nil:
                        ContentUnavailable(title: "Pick a calculator", message: "Search or choose one from the sidebar.", symbol: "function")
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
        }
        .searchable(text: $state.search, placement: .sidebar, prompt: "Search formulas")
        .background(WindowAccessor(pinned: state.workspace.pinned))
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
                    Label("Markets", systemImage: "chart.xyaxis.line")
                        .tag(SidebarItem.markets)
                    Label("Saved scenarios", systemImage: "tray.full")
                        .badge(state.workspace.scenarios.count)
                        .tag(SidebarItem.scenarios)
                    Label("History", systemImage: "clock.arrow.circlepath")
                        .tag(SidebarItem.history)
                }
                let favorites = state.workspace.favorites.compactMap { state.calculator($0) }
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
            Text("Calculations only. Not investment, tax or legal advice.")
                .font(.caption2).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14).padding(.vertical, 8)
        }
        .onChange(of: state.selection) { sel in
            if case .calc(let id)? = sel { state.workspace.lastSelection = id }
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
