import AppKit
import SwiftUI
import WealthCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Needed when launched from `swift run` rather than as a bundled .app.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    // Closing the window keeps the menu-bar utility running.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

extension Color {
    static let wealthAccent = Color(red: 0.11, green: 0.47, blue: 0.38)
}

@main
struct WealthDeskApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var state = AppState()
    @StateObject private var market = MarketStore()
    @StateObject private var roro = RoRoStore()

    var body: some Scene {
        Window("Wealth Desk", id: "main") {
            ContentView()
                .environmentObject(state)
                .environmentObject(market)
                .environmentObject(roro)
                .frame(minWidth: 860, minHeight: 560)
                .tint(.wealthAccent)
        }
        .defaultSize(width: 1120, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(after: .saveItem) {
                Button("Export Saved Work…") { state.exportWork() }
                    .keyboardShortcut("e", modifiers: [.command, .shift])
                Button("Import Saved Work…") { state.importWork() }
                    .keyboardShortcut("i", modifiers: [.command, .shift])
            }
            CommandMenu("Calculator") {
                Button("Calculator") { state.selection = .calculator }
                    .keyboardShortcut("k", modifiers: [.command, .shift])
                Button("Markets") { state.selection = .markets }
                    .keyboardShortcut("0", modifiers: [.command, .shift])
                Button("RoRo") { state.selection = .roro }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                Button("Scenarios") { state.selection = .scenarios }
                    .keyboardShortcut("1", modifiers: [.command, .shift])
                Button("History") { state.selection = .history }
                    .keyboardShortcut("2", modifiers: [.command, .shift])
                Divider()
                Toggle("Keep Window on Top", isOn: $state.workspace.pinned)
                    .keyboardShortcut("p", modifiers: [.command, .shift])
            }
        }

        MenuBarExtra("Wealth Desk", systemImage: "chart.line.uptrend.xyaxis") {
            MenuBarContent().environmentObject(state)
        }

        Settings {
            SettingsView().environmentObject(state).tint(.wealthAccent)
        }
    }
}

struct MenuBarContent: View {
    @EnvironmentObject var state: AppState
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Show Wealth Desk") {
            openWindow(id: "main")
            NSApp.activate(ignoringOtherApps: true)
        }
        Button("Calculator") {
            state.selection = .calculator
            openWindow(id: "main")
            NSApp.activate(ignoringOtherApps: true)
        }
        Toggle("Keep Window on Top", isOn: $state.workspace.pinned)
        let favorites = state.workspace.favorites.compactMap { state.calculator($0) }
        if !favorites.isEmpty {
            Divider()
            ForEach(favorites) { calc in
                Button(calc.name) {
                    state.select(calc)
                    openWindow(id: "main")
                    NSApp.activate(ignoringOtherApps: true)
                }
            }
        }
        Divider()
        Button("Quit Wealth Desk") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}

struct SettingsView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        Form {
            Section("Window") {
                Toggle("Keep the window above other apps", isOn: $state.workspace.pinned)
                Text("Closing the window keeps Wealth Desk in the menu bar. Use Quit to exit.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Tax data") {
                TaxDataPanel()
            }
            Section("Saved work") {
                HStack {
                    Button("Export…") { state.exportWork() }
                    Button("Import…") { state.importWork() }
                    Button("Show in Finder") {
                        NSWorkspace.shared.activateFileViewerSelecting([AppState.workspaceURL])
                    }
                }
                Text("Saved work lives in Application Support/Wealth Desk/workspace.json. Import merges and keeps your settings.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("About") {
                Text("No account or telemetry. Every calculation runs on this Mac. The Markets page fetches Treasury yields (Treasury.gov) and quotes (Yahoo Finance) only when you open it or press Refresh. Wealth Desk does math. It is not investment, tax or legal advice.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 520)
        .padding(.vertical, 8)
    }
}
