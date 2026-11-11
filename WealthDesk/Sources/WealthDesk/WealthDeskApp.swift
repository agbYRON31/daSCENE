import AppKit
import SwiftUI
import WealthCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Needed when launched from `swift run` rather than as a bundled .app.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        QAHooks.runIfRequested()
    }

    // Closing the window ends the session: the app quits and everything typed is gone.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
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
            RootView()
                .environmentObject(state)
                .environmentObject(market)
                .environmentObject(roro)
                .frame(minWidth: 960, minHeight: 620)
                .tint(.wealthAccent)
        }
        .defaultSize(width: 1240, height: 820)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Open Scenario File…") { state.openScenarioFile() }
                    .keyboardShortcut("o")
            }
            CommandGroup(after: .saveItem) {
                Button("Clear Session") { state.clearSession() }
                    .keyboardShortcut(.delete, modifiers: [.command, .shift])
            }
            CommandMenu("Go") {
                Button("Start Screen") { state.screen = .start }
                    .keyboardShortcut("0")
                Button("Advisor Mode") { state.enter(.advisor) }
                    .keyboardShortcut("1")
                Button("Client Mode") { state.showClient(nil) }
                    .keyboardShortcut("2")
                Divider()
                Button("RoRo Composite") { state.enter(.advisor); state.selection = .roro }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                Button("Markets") { state.enter(.advisor); state.selection = .markets }
                    .keyboardShortcut("m", modifiers: [.command, .shift])
                Button("Calculator") { state.enter(.advisor); state.selection = .calculator }
                    .keyboardShortcut("k", modifiers: [.command, .shift])
                Button("Session Scenarios") { state.enter(.advisor); state.selection = .scenarios }
                Button("Session History") { state.enter(.advisor); state.selection = .history }
                Divider()
                Toggle("Keep Window on Top", isOn: $state.prefs.pinned)
                    .keyboardShortcut("p", modifiers: [.command, .shift])
            }
        }

        Settings {
            SettingsView().environmentObject(state).tint(.wealthAccent)
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        Form {
            Section("Privacy and data") {
                Text("Numbers typed into calculators stay in memory for the current session and are erased when Wealth Desk quits. They are never saved automatically and never sent anywhere.")
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
                Text("Saved on this Mac: your favorites, watchlist tickers, tax-year choice and window settings, plus downloaded market data. A scenario file or PDF report is written only when you choose Save, to the place you pick.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Button("Clear Session Now") { state.clearSession() }
                    .disabled(state.session.isEmpty)
            }
            Section("Internet connections") {
                Text("Wealth Desk connects only to download public data. Requests contain series names or ticker symbols, never anything typed into a calculator.")
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 3) {
                    Text("• fred.stlouisfed.org — economic series for RoRo (Federal Reserve Bank of St. Louis)")
                    Text("• home.treasury.gov — daily Treasury yield curve")
                    Text("• query1.finance.yahoo.com — delayed prices for RoRo and the watchlist (unofficial feed)")
                    Text("• www.irs.gov — checks whether newer tax figures have been published")
                }
                .font(.caption).foregroundStyle(.secondary)
                Text("No account, sign-in, analytics, telemetry or cloud sync.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Tax data") {
                TaxDataPanel()
            }
            Section("Window") {
                Toggle("Keep the window above other apps", isOn: $state.prefs.pinned)
            }
            Section("About") {
                Text("Wealth Desk \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "2.0"). Educational calculations and hypothetical illustrations; not investment, tax or legal advice and not a recommendation. Independent application, not affiliated with or endorsed by Morgan Stanley, and not approved by any firm for use with client information.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .formStyle(.grouped)
        .frame(width: 560)
        .padding(.vertical, 8)
    }
}

/// Command-line hooks used by the build's quality checks. They do nothing in normal use.
///   --qa-report <folder>   renders sample PDF reports from catalog example inputs, then exits
@MainActor
enum QAHooks {
    static func runIfRequested() {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--qa-report"), i + 1 < args.count else { return }
        let folder = URL(fileURLWithPath: args[i + 1])
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var failures = 0
        do {
            let (catalog, tax) = try AppState.resourceURLs()
            let engine = try Engine(catalogURL: catalog, taxURL: tax)
            for id in ["fv_lump", "retirement_timeline", "retirement_mc", "portfolio_stress", "income_tax", "bond_duration", "ols"] {
                guard let calc = engine.calculator(id) else { failures += 1; continue }
                let inputs = calc.exampleInputs
                let eval = engine.evaluate(calc, inputs: inputs)
                let report = Report(title: calc.name, kind: "QA sample (catalog example inputs)",
                                    sections: [.calculator(calc, inputs: inputs, evaluation: eval, tax: engine.tax)])
                let data = ReportRenderer.pdf(report)
                if data.count < 2000 { failures += 1 }
                try data.write(to: folder.appendingPathComponent("\(id).pdf"))
                FileHandle.standardOutput.write("report \(id): \(data.count) bytes\n".data(using: .utf8)!)
            }
        } catch {
            FileHandle.standardOutput.write("QA report failed: \(error)\n".data(using: .utf8)!)
            failures += 1
        }
        exit(failures == 0 ? 0 : 1)
    }
}
