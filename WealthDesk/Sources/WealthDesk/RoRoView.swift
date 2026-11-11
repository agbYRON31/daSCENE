import AppKit
import SwiftUI
import WealthCore
import WebKit

/// Runs the RoRo composite (download → score → render) and keeps the latest dashboard.
/// Files live in Application Support/Wealth Desk/RoRo, mirroring roro.py's output folder:
/// data_cache/, roro_latest.html, roro_<date>.html/.json and runs.csv.
@MainActor
final class RoRoStore: ObservableObject {
    @Published var html: String?
    @Published var asof: String?
    @Published var summary: String?
    @Published var running = false
    @Published var progress: (Int, Int) = (0, 0)
    @Published var error: String?
    @Published var staleCount = 0
    @Published var lastUpdated: Date?

    nonisolated static var folder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Wealth Desk/RoRo", isDirectory: true)
    }
    nonisolated static var cacheDir: URL { folder.appendingPathComponent("data_cache", isDirectory: true) }
    nonisolated static var latestURL: URL { folder.appendingPathComponent("roro_latest.html") }
    nonisolated static var runsURL: URL { folder.appendingPathComponent("runs.csv") }

    init() {
        if let h = try? String(contentsOf: Self.latestURL, encoding: .utf8) {
            html = h
            lastUpdated = (try? FileManager.default.attributesOfItem(atPath: Self.latestURL.path)[.modificationDate]) as? Date
            if let json = try? Data(contentsOf: Self.latestJSONURL()), let obj = try? JSONSerialization.jsonObject(with: json) as? [String: Any] {
                applySummary(obj)
            }
        }
    }

    nonisolated static func latestJSONURL() -> URL { folder.appendingPathComponent("roro_latest.json") }

    nonisolated static func template() -> String? {
        if let u = Bundle.main.url(forResource: "roro_template", withExtension: "html") { return try? String(contentsOf: u, encoding: .utf8) }
        var dir = Bundle.main.executableURL?.deletingLastPathComponent()
        var candidates = [URL(fileURLWithPath: FileManager.default.currentDirectoryPath)]
        for _ in 0..<6 { if let d = dir { candidates.append(d); dir = d.deletingLastPathComponent() } }
        for base in candidates {
            let u = base.appendingPathComponent("Resources/roro_template.html")
            if let s = try? String(contentsOf: u, encoding: .utf8) { return s }
        }
        return nil
    }

    /// Refreshes when there's no dashboard yet or the last one was built on an earlier day.
    func refreshIfStale() {
        if let d = lastUpdated, Calendar.current.isDateInToday(d), html != nil { return }
        refresh()
    }

    func refresh(offline: Bool = false) {
        guard !running else { return }
        guard let template = Self.template() else { error = "The RoRo dashboard template is missing from the app."; return }
        running = true
        error = nil
        progress = (0, RoRoSources.fredSeries.count + RoRoSources.yahooTickers.count)
        let cache = Self.cacheDir
        Task {
            let data = await RoRoFetcher.load(cacheDir: cache, offline: offline) { n, total in
                Task { @MainActor in self.progress = (n, total) }
            }
            let result = await Task.detached(priority: .userInitiated) { () -> (String, Data, [String: Any])? in
                let today = data.index.last.map(DayMath.iso) ?? ""
                let model = RoRoEngine.build(data, lastRun: Self.lastRun(before: today))
                let json = model.serialized()
                guard let obj = try? JSONSerialization.jsonObject(with: json) as? [String: Any], obj["error"] == nil else { return nil }
                return (RoRoEngine.render(template: template, model: model), json, obj)
            }.value
            running = false
            guard let (page, json, obj) = result else {
                error = "Not enough data to score the model. Check your connection and try again."
                return
            }
            html = page
            lastUpdated = Date()
            applySummary(obj)
            save(page: page, json: json, model: obj)
        }
    }

    private func applySummary(_ obj: [String: Any]) {
        asof = obj["asof"] as? String
        staleCount = (obj["stale"] as? [Any])?.count ?? 0
        if let p = obj["posture"] as? [String: Any], let m = obj["master"] as? [String: Any] {
            let v = (p["value"] as? Double).map { String(format: "%+.0f", $0) } ?? "—"
            summary = "\(p["band"] as? String ?? "—") \(v) · \(m["head"] as? String ?? "")"
        }
    }

    /// Mirrors roro.py: dated copies plus the runs.csv log that drives the "last run" marker.
    private func save(page: String, json: Data, model: [String: Any]) {
        let fm = FileManager.default
        try? fm.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        let tag = model["asof_iso"] as? String ?? "latest"
        try? page.write(to: Self.latestURL, atomically: true, encoding: .utf8)
        try? page.write(to: Self.folder.appendingPathComponent("roro_\(tag).html"), atomically: true, encoding: .utf8)
        try? json.write(to: Self.latestJSONURL())
        try? json.write(to: Self.folder.appendingPathComponent("roro_\(tag).json"))
        var rows = Self.readRuns().filter { $0["date"] != tag }
        let hz = Dictionary(uniqueKeysWithValues: ((model["horizons"] as? [[String: Any]]) ?? []).map { ($0["key"] as? String ?? "", $0["value"]) })
        func s(_ v: Any?) -> String { (v as? Double).map { String($0) } ?? "" }
        rows.append(["date": tag, "tactical": s(hz["tactical"] ?? nil), "intermediate": s(hz["intermediate"] ?? nil),
                     "strategic": s(hz["strategic"] ?? nil), "posture": (model["posture"] as? [String: Any])?["band"] as? String ?? ""])
        let header = ["date", "tactical", "intermediate", "strategic", "posture"]
        let text = ([header.joined(separator: ",")] + rows.map { r in header.map { r[$0] ?? "" }.joined(separator: ",") }).joined(separator: "\n") + "\n"
        try? text.write(to: Self.runsURL, atomically: true, encoding: .utf8)
    }

    nonisolated static func readRuns() -> [[String: String]] {
        guard let text = try? String(contentsOf: runsURL, encoding: .utf8) else { return [] }
        let lines = text.split(whereSeparator: \.isNewline).map(String.init)
        guard let head = lines.first?.split(separator: ",").map(String.init) else { return [] }
        return lines.dropFirst().map { l in
            Dictionary(uniqueKeysWithValues: zip(head, l.split(separator: ",", omittingEmptySubsequences: false).map(String.init)))
        }
    }

    /// roro.last_run(): the newest logged run before today's as-of date.
    nonisolated static func lastRun(before today: String) -> RoRoEngine.LastRun? {
        guard let r = readRuns().filter({ ($0["date"] ?? "") < today }).last,
              let d = r["date"], let v = Double(r["intermediate"] ?? "") else { return nil }
        return RoRoEngine.LastRun(date: d, intermediate: v)
    }

    func openInBrowser() {
        guard html != nil else { return }
        NSWorkspace.shared.open(Self.latestURL)
    }
}

struct RoRoView: View {
    @EnvironmentObject var roro: RoRoStore

    var body: some View {
        VStack(spacing: 0) {
            statusBar
            Divider()
            if let html = roro.html {
                DashboardWebView(html: html)
            } else if roro.running {
                VStack(spacing: 12) {
                    ProgressView(value: Double(roro.progress.0), total: Double(max(roro.progress.1, 1))).frame(width: 260)
                    Text("Downloading \(roro.progress.1) series from FRED and Yahoo… The first run takes about a minute.")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailable(title: "RoRo Composite",
                                   message: roro.error ?? "Press Refresh to download the data and score the model.",
                                   symbol: "gauge.medium")
            }
        }
        .navigationTitle("RoRo")
        .navigationSubtitle(roro.asof.map { "As of \($0)" } ?? "Risk-on / risk-off composite")
        .toolbar {
            ToolbarItemGroup {
                Button { roro.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .keyboardShortcut("r")
                    .disabled(roro.running)
                    .help("Download the latest data and re-score the model")
                Button { roro.openInBrowser() } label: { Label("Open in browser", systemImage: "safari") }
                    .disabled(roro.html == nil)
                    .help("Open the dashboard as a page in your browser")
                Button { NSWorkspace.shared.open(RoRoStore.folder) } label: { Label("Show files", systemImage: "folder") }
                    .help("Show the dashboard files, data cache and run log in Finder")
            }
        }
        .onAppear { roro.refreshIfStale() }
    }

    private var statusBar: some View {
        HStack(spacing: 10) {
            if roro.running {
                ProgressView(value: Double(roro.progress.0), total: Double(max(roro.progress.1, 1))).frame(width: 120)
                Text(roro.progress.0 < roro.progress.1 ? "Fetching \(roro.progress.0)/\(roro.progress.1) series…" : "Scoring…")
                    .foregroundStyle(.secondary)
            } else if let s = roro.summary {
                Text(s).font(.callout.weight(.semibold))
                if let u = roro.lastUpdated {
                    Text("· updated \(u.formatted(date: .abbreviated, time: .shortened))").foregroundStyle(.secondary)
                }
            }
            if let e = roro.error, roro.html != nil {
                Label(e, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            }
            if roro.staleCount > 0 && !roro.running {
                Label("\(roro.staleCount) series from cache or missing (see Data Health)", systemImage: "externaldrive.badge.exclamationmark")
                    .foregroundStyle(.orange)
            }
            Spacer()
            Text("Not investment advice.").font(.caption).foregroundStyle(.tertiary)
        }
        .font(.callout)
        .padding(.horizontal, 14).padding(.vertical, 8)
    }
}

/// Shows the self-contained dashboard HTML. Links open in the default browser.
struct DashboardWebView: NSViewRepresentable {
    let html: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.setValue(false, forKey: "drawsBackground")
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loaded != html else { return }
        context.coordinator.loaded = html
        view.loadHTMLString(html, baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var loaded: String?

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .linkActivated, let url = action.request.url {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }
    }
}
