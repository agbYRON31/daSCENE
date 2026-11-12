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
                .frame(minWidth: 600, minHeight: 440)
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
///   --qa-size <w>x<h>      asks for that window size after launch, to check small-window layouts
@MainActor
enum QAHooks {
    /// --qa-client <folder>: fills every Client Mode tool with sample numbers, renders each screen
    /// to a PNG and each tool's report to a PDF, then exits. Exercises the same code the UI runs.
    static func runClient(_ folder: URL) {
        let state = AppState()
        let fill: [String: [String: String]] = [
            "client.growth": ["p": "25000", "m": "1000", "r": "6", "y": "25", "infl": "2.5"],
            "client.retirement": ["age": "45", "retire": "65", "bal": "750000", "c": "30000", "spend": "110000", "other": "45000",
                                  "rpre": "6", "rpost": "5", "infl": "2.5", "sd": "12"],
            "client.decisions.B": ["retire": "60", "c": "45000"],
            "client.risk": ["v": "2000000", "we": "60", "wb": "40", "eq": "-20", "dy": "1"],
            "client.risk.B": ["we": "40", "wb": "60"],
            "client.risk.vol": ["sa": "16", "sb": "6", "rho": "0.1"],
            "client.inflation": ["c": "80000", "i": "3", "n": "20"],
            "client.taxdrag": ["a": "100000", "r": "7", "t": "24", "n": "20"],
            "client.incometax": ["ti": "250000"],
        ]
        for (k, v) in fill { for (id, x) in v { state.setClient(k, id, x) } }
        var failures = 0
        func say(_ s: String) { FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!) }
        func png(_ view: AnyView, _ name: String) {
            let r = ImageRenderer(content: view.environmentObject(state).frame(width: 1240, height: 1500).background(Color.white)
                .environment(\.colorScheme, .light))
            r.scale = 1
            guard let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                  let data = rep.representation(using: .png, properties: [:]) else { failures += 1; say("render \(name) FAILED"); return }
            try? data.write(to: folder.appendingPathComponent("\(name).png"))
        }
        for tool in ClientTool.allCases where tool != .market {
            let calcs = ClientReports.calcs(for: tool, state: state)
            let bad = calcs.filter { !$0.1.ok }
            if calcs.isEmpty || !bad.isEmpty {
                failures += 1
                say("\(tool.rawValue): INCOMPLETE \(bad.map { "\($0.0): missing \($0.1.missing) problems \($0.1.problems)" })")
            }
            let sections = calcs.filter(\.1.ok).map { ReportSection.calculator($0.1.calc, inputs: $0.1.inputs, evaluation: $0.1.eval,
                                                                               title: $0.0, labels: $0.1.labels, tax: state.engine?.tax) }
            let pdf = ReportRenderer.pdf(Report(title: ClientSpec.title(tool), kind: "Client illustration (QA sample numbers)", sections: sections))
            if pdf.count < 2000 { failures += 1 }
            try? pdf.write(to: folder.appendingPathComponent("client-\(tool.rawValue).pdf"))
            say("\(tool.rawValue): \(calcs.count) calculators, key results \(calcs.map { Format.plain($0.1.v(0), maxDecimals: 4) }), pdf \(pdf.count) bytes")
        }
        png(AnyView(GrowthTool()), "growth"); png(AnyView(RetirementTool()), "retirement"); png(AnyView(RiskTool()), "risk")
        png(AnyView(DecisionsTool()), "decisions"); png(AnyView(TaxesTool()), "taxes")
        // A blank session must show no numbers anywhere.
        let blank = AppState()
        for tool in ClientTool.allCases where ClientReports.calcs(for: tool, state: blank).contains(where: { $0.1.ok }) {
            failures += 1; say("\(tool.rawValue): shows results with nothing entered")
        }
        say(failures == 0 ? "client QA: PASS" : "client QA: \(failures) FAILURES")
        exit(failures == 0 ? 0 : 1)
    }

    static func runIfRequested() {
        let args = CommandLine.arguments
        // --qa-size <width>x<height>: asks for that window size shortly after launch (the minimum still applies).
        if let i = args.firstIndex(of: "--qa-size"), i + 1 < args.count {
            let p = args[i + 1].split(separator: "x").compactMap { Double($0) }
            if p.count == 2 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    guard let w = NSApp.windows.first(where: { $0.isVisible }) else { return }
                    w.setContentSize(NSSize(width: p[0], height: p[1]))
                }
            }
        }
        if let i = args.firstIndex(of: "--qa-client"), i + 1 < args.count {
            let folder = URL(fileURLWithPath: args[i + 1])
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            runClient(folder)
        }
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
