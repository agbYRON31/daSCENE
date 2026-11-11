import AppKit
import Charts
import SwiftUI
import UniformTypeIdentifiers
import WealthCore
import WebKit

// RoRo Composite: download → score → show. The dashboard is native; the original HTML report
// is still available as the "Full report" tab. Requests carry only series names and tickers.

extension JSONValue {
    subscript(i: Int) -> JSONValue? { array.flatMap { $0.indices.contains(i) ? $0[i] : nil } }
    var items: [JSONValue] { array ?? [] }
    var num: Double { double ?? .nan }
    var str: String { string ?? "" }
    var flag: Bool { if case .bool(let b) = self { return b }; return false }

    static func from(_ any: Any) -> JSONValue {
        switch any {
        case let d as [String: Any]: return .object(d.keys.sorted().map { ($0, from(d[$0]!)) })
        case let a as [Any]: return .array(a.map(from))
        case let s as String: return .string(s)
        case let n as NSNumber: return CFGetTypeID(n) == CFBooleanGetTypeID() ? .bool(n.boolValue) : .number(n.doubleValue)
        default: return .null
        }
    }
}

@MainActor
final class RoRoStore: ObservableObject {
    @Published var model: JSONValue?
    @Published var running = false
    @Published var progress: (Int, Int) = (0, 0)
    @Published var error: String?
    /// When the data was last downloaded and scored successfully.
    @Published var lastRefresh: Date?

    nonisolated static var folder: URL { AppState.supportFolder.appendingPathComponent("RoRo", isDirectory: true) }
    nonisolated static var cacheDir: URL { folder.appendingPathComponent("data_cache", isDirectory: true) }
    nonisolated static var latestJSON: URL { folder.appendingPathComponent("roro_latest.json") }
    nonisolated static var runsURL: URL { folder.appendingPathComponent("runs.csv") }

    init() {
        if let data = try? Data(contentsOf: Self.latestJSON), let obj = try? JSONSerialization.jsonObject(with: data) {
            model = .from(obj)
            lastRefresh = (try? FileManager.default.attributesOfItem(atPath: Self.latestJSON.path)[.modificationDate]) as? Date
        }
    }

    nonisolated static func template() -> String? {
        if let u = Bundle.main.url(forResource: "roro_template", withExtension: "html") { return try? String(contentsOf: u, encoding: .utf8) }
        var dir = Bundle.main.executableURL?.deletingLastPathComponent()
        var candidates = [URL(fileURLWithPath: FileManager.default.currentDirectoryPath)]
        for _ in 0..<6 { if let d = dir { candidates.append(d); dir = d.deletingLastPathComponent() } }
        for base in candidates {
            if let s = try? String(contentsOf: base.appendingPathComponent("Resources/roro_template.html"), encoding: .utf8) { return s }
        }
        return nil
    }

    /// The original single-file HTML report for the current model.
    var html: String? {
        guard let model, let t = Self.template() else { return nil }
        return RoRoEngine.render(template: t, model: model)
    }

    var staleSeries: [JSONValue] { model?["stale"]?.items ?? [] }

    /// One word for the header: is this fresh, cached or unavailable?
    var status: (label: String, color: Color, detail: String) {
        guard let model else { return ("No data", .secondary, "Press Refresh to download the data.") }
        let asof = model["asof"]?.str ?? ""
        let refreshed = lastRefresh.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "unknown"
        if error != nil {
            return ("Cached", .orange, "Couldn't refresh. Showing the last downloaded data: as of \(asof), downloaded \(refreshed).")
        }
        if !staleSeries.isEmpty {
            return ("Partly cached", .orange, "\(staleSeries.count) of \(model["health"]?.items.count ?? 0) series came from cache or are unavailable. Data as of \(asof), downloaded \(refreshed).")
        }
        let today = lastRefresh.map { Calendar.current.isDateInToday($0) } ?? false
        return (today ? "Current" : "Earlier download", today ? .green : .orange,
                "Data as of \(asof) (latest published or closing values, not real-time), downloaded \(refreshed).")
    }

    /// Refreshes when there's no model yet or the last one was built on an earlier day.
    func refreshIfStale() {
        if let d = lastRefresh, Calendar.current.isDateInToday(d), model != nil { return }
        refresh()
    }

    func refresh() {
        guard !running else { return }
        running = true
        error = nil
        progress = (0, RoRoSources.fredSeries.count + RoRoSources.yahooTickers.count)
        let cache = Self.cacheDir
        Task {
            let data = await RoRoFetcher.load(cacheDir: cache) { n, total in
                Task { @MainActor in self.progress = (n, total) }
            }
            let fetched = data.health.filter { $0.status == "ok" }.count
            let built = await Task.detached(priority: .userInitiated) { () -> JSONValue? in
                let today = data.index.last.map(DayMath.iso) ?? ""
                let m = RoRoEngine.build(data, lastRun: Self.lastRun(before: today))
                return m["error"] == nil ? m : nil
            }.value
            running = false
            guard let built else {
                error = "No data could be downloaded and nothing is cached yet. Check the internet connection and try again."
                return
            }
            model = built
            if fetched == 0 {
                error = "Offline: every series came from the cache."
            } else {
                lastRefresh = Date()
                save(built)
            }
        }
    }

    /// Mirrors roro.py: the latest model plus the runs.csv log that drives the "last run" marker.
    private func save(_ model: JSONValue) {
        try? FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        try? model.serialized().write(to: Self.latestJSON)
        let tag = model["asof_iso"]?.str ?? "latest"
        var rows = Self.readRuns().filter { $0["date"] != tag }
        var hz: [String: String] = [:]
        for h in model["horizons"]?.items ?? [] { hz[h["key"]?.str ?? ""] = h["value"]?.double.map { String($0) } ?? "" }
        rows.append(["date": tag, "tactical": hz["tactical"] ?? "", "intermediate": hz["intermediate"] ?? "",
                     "strategic": hz["strategic"] ?? "", "posture": model["posture"]?["band"]?.str ?? ""])
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

    nonisolated static func lastRun(before today: String) -> RoRoEngine.LastRun? {
        guard let r = readRuns().filter({ ($0["date"] ?? "") < today }).last,
              let d = r["date"], let v = Double(r["intermediate"] ?? "") else { return nil }
        return RoRoEngine.LastRun(date: d, intermediate: v)
    }

    /// Saves the full HTML report where the user chooses.
    func exportHTML(state: AppState) {
        guard let html else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.html]
        panel.nameFieldStringValue = "RoRo \(model?["asof_iso"]?.str ?? "report").html"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try html.write(to: url, atomically: true, encoding: .utf8); state.flash("Report saved.") }
        catch { state.flash("Couldn't save: \(error.localizedDescription)") }
    }
}

// MARK: - Page

struct RoRoView: View {
    @EnvironmentObject var roro: RoRoStore
    @EnvironmentObject var state: AppState
    @State private var tab = 0

    var body: some View {
        VStack(spacing: 0) {
            statusBar
            Picker("", selection: $tab) {
                Text("Overview").tag(0)
                Text("Factors").tag(1)
                Text("Scenarios & history").tag(2)
                Text("Data status").tag(3)
                Text("Full report").tag(4)
            }
            .pickerStyle(.segmented).labelsHidden()
            .frame(maxWidth: 620)
            .padding(.bottom, 8)
            Divider()
            if let m = roro.model {
                switch tab {
                case 0: ScrollView { RoRoOverview(m: m).padding(22).frame(maxWidth: 1100).frame(maxWidth: .infinity) }
                case 1: ScrollView { RoRoFactors(m: m).padding(22).frame(maxWidth: 1100).frame(maxWidth: .infinity) }
                case 2: ScrollView { RoRoScenarios(m: m).padding(22).frame(maxWidth: 1100).frame(maxWidth: .infinity) }
                case 3: ScrollView { RoRoDataStatus(m: m).padding(22).frame(maxWidth: 1100).frame(maxWidth: .infinity) }
                default:
                    if let html = roro.html { DashboardWebView(html: html) }
                    else { ContentUnavailable(title: "Report unavailable", message: "The report template is missing from the app.", symbol: "doc") }
                }
            } else if roro.running {
                VStack(spacing: 12) {
                    ProgressView(value: Double(roro.progress.0), total: Double(max(roro.progress.1, 1))).frame(width: 260)
                    Text("Downloading \(roro.progress.1) public data series from FRED and Yahoo Finance…").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailable(title: "RoRo Composite",
                                   message: roro.error ?? "Press Refresh to download the data and score the model.",
                                   symbol: "gauge.medium")
            }
        }
        .navigationTitle("RoRo Composite")
        .navigationSubtitle(roro.model?["asof"].map { "Data as of \($0.str)" } ?? "Risk-on / risk-off conditions")
        .toolbar {
            ToolbarItemGroup {
                Button { roro.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .keyboardShortcut("r")
                    .disabled(roro.running)
                    .help("Download the latest published data and re-score the model")
                Button { roro.exportHTML(state: state) } label: { Label("Save report", systemImage: "square.and.arrow.up") }
                    .disabled(roro.model == nil)
                    .help("Save the full report as an HTML file to a location you choose")
            }
        }
        .onAppear { roro.refreshIfStale() }
    }

    private var statusBar: some View {
        let s = roro.status
        return HStack(spacing: 10) {
            if roro.running {
                ProgressView(value: Double(roro.progress.0), total: Double(max(roro.progress.1, 1))).frame(width: 120)
                Text(roro.progress.0 < roro.progress.1 ? "Downloading \(roro.progress.0)/\(roro.progress.1) series…" : "Scoring…").foregroundStyle(.secondary)
            } else {
                Text(s.label.uppercased()).font(.caption.weight(.bold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(s.color.opacity(0.18), in: Capsule()).foregroundStyle(s.color)
                Text(s.detail).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer()
            Text("Model output for discussion. Not investment advice.").font(.caption).foregroundStyle(.tertiary)
        }
        .font(.callout)
        .padding(.horizontal, 14).padding(.vertical, 8)
    }
}

// MARK: - Helpers

enum RoRoStyle {
    static func color(_ score: Double) -> Color { score.isNaN ? .secondary : (score >= 20 ? .green : (score <= -20 ? .red : .orange)) }
    static func signed(_ v: Double, _ decimals: Int = 0) -> String { v.isNaN ? "—" : String(format: "%+.\(decimals)f", v).replacingOccurrences(of: "-", with: "−") }
    static func pct(_ v: Double) -> String { v.isNaN ? "—" : String(format: "%+.1f%%", v).replacingOccurrences(of: "-", with: "−") }
    static func bandColor(_ band: String) -> Color { band == "OFFENSE" ? .green : (band == "DEFENSE" ? .red : .orange) }
}

/// −100 … +100 scale with the ±20 lines marked.
struct ScoreBar: View {
    let value: Double
    var height: CGFloat = 10
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let x = { (v: Double) in CGFloat((min(max(v, -100), 100) + 100) / 200) * w }
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.08))
                Rectangle().fill(Color.primary.opacity(0.25)).frame(width: 1).offset(x: x(-20))
                Rectangle().fill(Color.primary.opacity(0.25)).frame(width: 1).offset(x: x(20))
                Rectangle().fill(Color.primary.opacity(0.4)).frame(width: 1).offset(x: x(0))
                if !value.isNaN {
                    Capsule().fill(RoRoStyle.color(value))
                        .frame(width: max(abs(x(value) - x(0)), 3))
                        .offset(x: min(x(value), x(0)))
                }
            }
        }
        .frame(height: height)
    }
}

struct Spark: View {
    let values: [Double]
    var color: Color = .wealthAccent
    var body: some View {
        Chart(Array(values.enumerated()), id: \.offset) { i, v in
            LineMark(x: .value("i", i), y: .value("v", v)).foregroundStyle(color).lineStyle(StrokeStyle(lineWidth: 1.2))
        }
        .chartXAxis(.hidden).chartYAxis(.hidden)
        .chartYScale(domain: .automatic(includesZero: false))
        .frame(width: 90, height: 24)
    }
}

struct RoRoCard<Content: View>: View {
    let title: String
    var note: String? = nil
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(.secondary)
            content
            if let note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.primary.opacity(0.08)))
    }
}

// MARK: - Overview

struct RoRoOverview: View {
    @EnvironmentObject var state: AppState
    let m: JSONValue
    struct Pt: Identifiable { let id = UUID(); let date: Date; let value: Double; let dial: String }

    var history: [Pt] {
        guard let h = m["history"] else { return [] }
        let dates = h["dates"]?.items.compactMap { DayMath.parse($0.str).map(DayMath.date) } ?? []
        var out: [Pt] = []
        for (key, name) in [("tactical", "Tactical"), ("intermediate", "Intermediate"), ("strategic", "Strategic")] {
            for (d, v) in zip(dates, h[key]?.items ?? []) where v.double != nil { out.append(Pt(date: d, value: v.num, dial: name)) }
        }
        return out
    }

    var body: some View {
        let p = m["posture"] ?? .null
        let master = m["master"] ?? .null
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                RoRoCard(title: "Posture · driven by the Intermediate dial (1–3 months)") {
                    let band = p["band"]?.str ?? "—"
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(band).font(.system(size: 40, weight: .bold, design: .serif)).foregroundStyle(RoRoStyle.bandColor(band))
                            .lineLimit(1).minimumScaleFactor(0.5).layoutPriority(1)
                        if let lean = p["lean"]?.str, !lean.isEmpty { Text(lean).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                        Spacer()
                        Text(RoRoStyle.signed(p["value"]?.num ?? .nan)).font(.system(size: 30, weight: .semibold, design: .rounded)).monospacedDigit()
                    }
                    ScoreBar(value: p["value"]?.num ?? .nan, height: 12)
                    Text("\(p["status"]?.str ?? "") · in \(band) since \(p["since"]?.str ?? "—") (\(Int(p["days_in"]?.num ?? 0)) sessions) · \(RoRoStyle.signed(p["delta"]?.num ?? .nan)) pts since \(p["prev_date"]?.str ?? "last run")")
                        .font(.callout).foregroundStyle(.secondary)
                    Text("Offense above +20, Defense below −20. \(Int(p["to_off"]?.num ?? 0)) pts from the Offense line, \(Int(p["to_def"]?.num ?? 0)) from the Defense line.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                RoRoCard(title: "Master signal", note: "Generic model playbook for discussion. It is not a recommendation and takes no account of any person's situation.") {
                    Text(master["head"]?.str ?? "—").font(.title2.weight(.bold))
                    Text("\(master["regime"]?.str ?? "") · confidence \(master["confidence"]?.str ?? "")").font(.callout).foregroundStyle(.secondary)
                    Text(master["action"]?.str ?? "").font(.callout).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: 380)
            }
            HStack(alignment: .top, spacing: 16) {
                ForEach(Array((m["horizons"]?.items ?? []).enumerated()), id: \.offset) { _, h in
                    RoRoCard(title: "\(h["label"]?.str ?? "") · \(h["span"]?.str ?? "")") {
                        HStack(alignment: .firstTextBaseline) {
                            Text(RoRoStyle.signed(h["value"]?.num ?? .nan)).font(.system(size: 30, weight: .semibold, design: .rounded)).monospacedDigit()
                                .foregroundStyle(RoRoStyle.color(h["value"]?.num ?? .nan))
                            Spacer()
                            Text(h["regime"]?.str ?? "").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        }
                        ScoreBar(value: h["value"]?.num ?? .nan)
                        Text("\(RoRoStyle.signed(h["wow"]?.num ?? .nan)) vs. a week ago · 4-week average \(RoRoStyle.signed(h["avg4w"]?.num ?? .nan))").font(.caption).foregroundStyle(.secondary)
                        Text(h["plain"]?.str ?? "").font(.callout).fixedSize(horizontal: false, vertical: true)
                        Text("Strongest: \(h["top"]?["bucket"]?.str ?? "—") (\(RoRoStyle.signed(h["top"]?["score"]?.num ?? .nan))) · weakest: \(h["low"]?["bucket"]?.str ?? "—") (\(RoRoStyle.signed(h["low"]?["score"]?.num ?? .nan)))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            RoRoCard(title: "Six buckets", note: "Each bucket is the weighted average of its factor scores (−100 risk-off to +100 risk-on). See the Factors tab for every input.") {
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 9) {
                    ForEach(Array((m["buckets"]?.items ?? []).enumerated()), id: \.offset) { _, b in
                        GridRow {
                            Text(b["name"]?.str ?? "").frame(width: 170, alignment: .leading)
                            ScoreBar(value: b["score"]?.num ?? .nan).frame(minWidth: 160)
                            Text(RoRoStyle.signed(b["score"]?.num ?? .nan)).monospacedDigit().fontWeight(.semibold).frame(width: 44, alignment: .trailing)
                            Text("\(RoRoStyle.signed(b["wow"]?.num ?? .nan)) wk").font(.caption).foregroundStyle(.secondary).frame(width: 60, alignment: .trailing)
                            Spark(values: b["spark"]?.items.compactMap(\.double) ?? [])
                            Text("\(Int(b["factors_live"]?.num ?? 0))/\(Int(b["factors_total"]?.num ?? 0)) live").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            RoRoCard(title: "Last 24 months", note: "Tactical is the raw daily composite; Intermediate and Strategic are smoothed (5- and 20-day).") {
                Chart {
                    RuleMark(y: .value("Offense", 20)).foregroundStyle(Color.green.opacity(0.5)).lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    RuleMark(y: .value("Defense", -20)).foregroundStyle(Color.red.opacity(0.5)).lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    ForEach(history) { pt in
                        LineMark(x: .value("Date", pt.date), y: .value("Score", pt.value))
                            .foregroundStyle(by: .value("Dial", pt.dial))
                            .lineStyle(StrokeStyle(lineWidth: pt.dial == "Intermediate" ? 2.2 : 1.1))
                    }
                }
                .chartForegroundStyleScale(["Tactical": Color.gray.opacity(0.6), "Intermediate": Color.wealthAccent, "Strategic": Color.blue.opacity(0.7)])
                .chartYScale(domain: -100...100)
                .frame(height: 240)
            }
            let flags = m["flags"]?.items ?? []
            RoRoCard(title: "Flags") {
                if flags.isEmpty { Text("No divergence or risk flags are active.").foregroundStyle(.secondary) }
                ForEach(Array(flags.enumerated()), id: \.offset) { _, f in
                    HStack(alignment: .top, spacing: 10) {
                        Text(f["kind"]?.str ?? "").font(.caption2.weight(.bold))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background((f["kind"]?.str == "RISK" ? Color.red : f["kind"]?.str == "OPP" ? Color.green : Color.orange).opacity(0.18), in: Capsule())
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(f["title"]?.str ?? "") · \(Int(f["sessions"]?.num ?? 0)) sessions").font(.callout.weight(.semibold))
                            Text(f["text"]?.str ?? "").font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            RoRoCard(title: "Explore a what-if", note: "RoRo scores describe current conditions. They are not converted into return predictions. The stress test shows the effect of a market move you choose; it says nothing about how likely that move is.") {
                HStack(spacing: 12) {
                    Button("Open the Portfolio stress test") { state.showInAdvisor("portfolio_stress") }
                    Button("Open the risk tool in Client Mode") { state.showClient(.risk) }
                }
            }
        }
    }
}

// MARK: - Factors

struct RoRoFactors: View {
    let m: JSONValue
    @State private var bucket = "ALL"

    private func health(_ m: JSONValue) -> [String: JSONValue] {
        var out: [String: JSONValue] = [:]
        for h in m["health"]?.items ?? [] { out["\(h["source"]?.str ?? "")|\(h["id"]?.str ?? "")"] = h }
        return out
    }

    var body: some View {
        let hmap = health(m)
        let names = m["bucket_names"] ?? .null
        let rows = (m["factors"]?.items ?? []).filter { bucket == "ALL" || $0["bucket"]?.str == bucket }
        VStack(alignment: .leading, spacing: 14) {
            Picker("", selection: $bucket) {
                Text("All \(m["factors"]?.items.count ?? 0)").tag("ALL")
                ForEach(RoRoConfig.bucketKeys, id: \.self) { Text(names[$0]?.str ?? $0).tag($0) }
            }
            .pickerStyle(.segmented).labelsHidden()
            RoRoCard(title: "Factor detail", note: "Reading → score uses a fixed piecewise-linear map for each factor (hover a score to see its map). Weight is the factor's share of its bucket today; missing factors are re-weighted away.") {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                    GridRow {
                        Text("Factor"); Text("Reading").gridColumnAlignment(.trailing); Text("Score").gridColumnAlignment(.trailing)
                        Text(""); Text("Weight").gridColumnAlignment(.trailing); Text("Signal"); Text("Data source · latest observation · status")
                    }
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Divider()
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, f in
                        let id = f["id"]?.str ?? ""
                        let score = f["score"]?.num ?? .nan
                        GridRow {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(f["name"]?.str ?? "").lineLimit(1)
                                Text(names[f["bucket"]?.str ?? ""]?.str ?? "").font(.caption2).foregroundStyle(.secondary)
                            }
                            Text(f["reading"]?.str ?? "—").monospacedDigit()
                            Text(RoRoStyle.signed(score)).monospacedDigit().fontWeight(.semibold).foregroundStyle(RoRoStyle.color(score))
                                .help(RoRoConfig.factor(id).map { "Score map (reading → score): " + $0.map.map { "\(Format.plain($0.0 * (RoRoConfig.factor(id)?.scale ?? 1), maxDecimals: 2)) → \(Int($0.1))" }.joined(separator: ", ") } ?? "")
                            ScoreBar(value: score).frame(width: 110)
                            Text(f["weight"]?.double.map { "\(Int($0))%" } ?? "—").monospacedDigit().foregroundStyle(.secondary)
                            Text(f["signal"]?.str ?? "").font(.caption2.weight(.bold)).foregroundStyle(RoRoStyle.color(score))
                            VStack(alignment: .leading, spacing: 1) {
                                ForEach(RoRoConfig.factorSeries[id]?.prefix(3) ?? [], id: \.id) { s in
                                    let h = hmap["\(s.source)|\(s.id)"]
                                    Text("\(s.source) \(s.id) · \(h?["last"]?.string ?? "no data") · \(SeriesStatus.label(source: s.source, status: h?["status"]?.str ?? "missing"))")
                                        .font(.caption2).foregroundStyle(SeriesStatus.isGood(h?["status"]?.str ?? "missing") ? Color.secondary : Color.orange)
                                }
                                if (RoRoConfig.factorSeries[id]?.count ?? 0) > 3 {
                                    Text("+ \((RoRoConfig.factorSeries[id]?.count ?? 0) - 3) more (see Data status)").font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            let v = m["vix"] ?? .null
            if v != .null {
                RoRoCard(title: "VIX context", note: "Historical averages of S&P 500 returns over the following 12 months, grouped by how far the VIX was above its long-run average (since \(Int(v["since"]?.num ?? 0))). Past averages, not a forecast.") {
                    Text("VIX \(Format.plain(v["current"]?.num ?? .nan, maxDecimals: 1)) · long-run mean \(Format.plain(v["mean"]?.num ?? .nan, maxDecimals: 1)) · \(v["zone"]?.str ?? "")").font(.callout.weight(.semibold))
                    Grid(alignment: .trailing, horizontalSpacing: 18, verticalSpacing: 5) {
                        GridRow {
                            Text("VIX range").gridColumnAlignment(.leading); Text("Avg. next-12-month return"); Text("Share positive"); Text("Days observed")
                        }.font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        GridRow {
                            Text("Below mean + 1σ"); Text(RoRoStyle.pct(v["base"]?["ret"]?.num ?? .nan)); Text(v["base"]?["win"]?.double.map { "\(Int($0))%" } ?? "—"); Text("")
                        }
                        ForEach(Array((v["levels"]?.items ?? []).enumerated()), id: \.offset) { _, l in
                            GridRow {
                                Text("\(Format.plain(l["lo"]?.num ?? .nan, maxDecimals: 1))" + (l["hi"]?.double.map { " – \(Format.plain($0, maxDecimals: 1))" } ?? " and above"))
                                Text(RoRoStyle.pct(l["ret"]?.num ?? .nan)); Text(l["win"]?.double.map { "\(Int($0))%" } ?? "—"); Text("\(Int(l["n"]?.num ?? 0))")
                            }
                        }
                    }
                    .monospacedDigit().font(.callout)
                }
            }
            let lead = m["leadership"] ?? .null
            RoRoCard(title: "Asset-class leadership", note: "Ranked by a blend of 13-week (60%) and 4-week (40%) price change of representative ETFs.") {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 5) {
                    GridRow { Text("#"); Text("Asset class"); Text("ETFs"); Text("13 weeks").gridColumnAlignment(.trailing); Text("4 weeks").gridColumnAlignment(.trailing); Text("Trend") }
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(Array((lead["rows"]?.items ?? []).enumerated()), id: \.offset) { _, r in
                        GridRow {
                            Text("\(Int(r["rank"]?.num ?? 0))"); Text(r["name"]?.str ?? ""); Text(r["tickers"]?.str ?? "").foregroundStyle(.secondary)
                            Text(RoRoStyle.pct(r["r13"]?.num ?? .nan)).monospacedDigit(); Text(RoRoStyle.pct(r["r4"]?.num ?? .nan)).monospacedDigit()
                            Text(r["trend"]?.str ?? "").foregroundStyle(.secondary)
                        }
                    }
                }
                .font(.callout)
            }
        }
    }
}

enum SeriesStatus {
    static func isGood(_ s: String) -> Bool { s == "ok" }
    /// Plain statement of how fresh a series is. Nothing here is real-time.
    static func label(source: String, status: String) -> String {
        if status == "ok" { return source == "FRED" ? "latest published" : "latest close (delayed)" }
        if status == "missing" { return "unavailable" }
        if status.hasPrefix("cache") || status.contains("using cache") { return "cached (download failed)" }
        return status
    }
}

// MARK: - Scenarios & history

struct RoRoScenarios: View {
    let m: JSONValue

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            RoRoCard(title: "Scenario re-scores", note: "Each card re-scores the model after replacing some factor readings with the stated shock values. It shows how the dials would read if those readings occurred. It is a mechanical re-score with no probability attached, and it is not a forecast of portfolio returns.") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 14)], alignment: .leading, spacing: 14) {
                    ForEach(Array((m["scenarios"]?.items ?? []).enumerated()), id: \.offset) { _, s in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text(s["name"]?.str ?? "").font(.headline)
                                Spacer()
                                Text(s["dir"]?.str ?? "").font(.caption2.weight(.bold)).foregroundStyle(s["dir"]?.str == "RISK-ON" ? Color.green : Color.red)
                            }
                            Text(s["desc"]?.str ?? "").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            ForEach(Array((s["horizons"]?.items ?? []).enumerated()), id: \.offset) { _, h in
                                HStack {
                                    Text(h["label"]?.str ?? "").frame(width: 100, alignment: .leading)
                                    Text("\(RoRoStyle.signed(h["today"]?.num ?? .nan)) → \(RoRoStyle.signed(h["after"]?.num ?? .nan))").monospacedDigit()
                                    Text("(\(RoRoStyle.signed(h["delta"]?.num ?? .nan)))").monospacedDigit().foregroundStyle(.secondary)
                                    Spacer()
                                    Text(h["posture"]?.str ?? "").font(.caption2.weight(.bold)).foregroundStyle(RoRoStyle.bandColor(h["posture"]?.str ?? ""))
                                }
                                .font(.callout)
                            }
                            Text("Largest score moves: " + (s["moves"]?.items ?? []).map { "\($0["name"]?.str ?? "") \(RoRoStyle.signed($0["delta"]?.num ?? .nan))" }.joined(separator: " · "))
                                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
            RoRoCard(title: "Historical look-alikes", note: "Past month-ends whose six bucket scores most resembled today's, and what the S&P 500 did afterwards. “Signal” replays the Offense/Defense rule with today's score maps on revised data, so these are in-sample illustrations, not out-of-sample evidence and not a prediction.") {
                Grid(alignment: .trailing, horizontalSpacing: 14, verticalSpacing: 6) {
                    GridRow {
                        Text("Period").gridColumnAlignment(.leading); Text("Match"); Text("S&P +3m"); Text("+6m"); Text("+12m"); Text("Max drawdown")
                        Text("Rule vs. hold"); Text("Outcome").gridColumnAlignment(.leading)
                    }.font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(Array((m["analogs"]?.items ?? []).enumerated()), id: \.offset) { _, a in
                        GridRow {
                            Text(a["date"]?.str ?? ""); Text("\(Int(a["sim"]?.num ?? 0))%")
                            Text(RoRoStyle.pct(a["fwd3"]?.num ?? .nan)); Text(RoRoStyle.pct(a["fwd6"]?.num ?? .nan)); Text(RoRoStyle.pct(a["fwd12"]?.num ?? .nan))
                            Text(RoRoStyle.pct(a["maxdd"]?.num ?? .nan)); Text(RoRoStyle.pct(a["net"]?.num ?? .nan))
                            Text(a["verdict"]?.str.capitalized ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .monospacedDigit().font(.callout)
                if (m["analogs"]?.items ?? []).isEmpty { Text("Not enough history to find look-alikes.").foregroundStyle(.secondary) }
            }
        }
    }
}

// MARK: - Data status & methodology

struct RoRoDataStatus: View {
    @EnvironmentObject var roro: RoRoStore
    let m: JSONValue

    var body: some View {
        let health = m["health"]?.items ?? []
        VStack(alignment: .leading, spacing: 14) {
            RoRoCard(title: "Where the data comes from") {
                Text("• FRED (Federal Reserve Bank of St. Louis), public CSV feed: 18 economic, rate and credit series. Official published data; most series lag by a day to a month.")
                Text("• Yahoo Finance chart feed: daily closing prices for 42 indexes, ETFs, futures and currencies. This is an unofficial, unlicensed feed: prices are delayed, can lag by a day, and the feed may change or stop without notice.")
                Text("• Nothing here is real-time. Requests contain only the series names and tickers below, never anything typed into a calculator.")
                Text("Scores are computed on this Mac at \(m["generated"]?.str ?? "—") from data as of \(m["asof"]?.str ?? "—"). Last successful download: \(roro.lastRefresh.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "none").")
                    .foregroundStyle(.secondary)
            }
            .font(.callout)
            RoRoCard(title: "Every series · \(health.filter { $0["status"]?.str == "ok" }.count) of \(health.count) downloaded this run") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 10)], alignment: .leading, spacing: 6) {
                    ForEach(Array(health.enumerated()), id: \.offset) { _, h in
                        let status = h["status"]?.str ?? "missing"
                        HStack(spacing: 8) {
                            Circle().fill(SeriesStatus.isGood(status) ? Color.green : (status == "missing" ? Color.red : Color.orange)).frame(width: 7, height: 7)
                            Text("\(h["source"]?.str ?? "") \(h["id"]?.str ?? "")").font(.system(.caption, design: .monospaced))
                            Spacer()
                            Text(h["last"]?.string ?? "—").font(.caption).monospacedDigit()
                            Text(SeriesStatus.label(source: h["source"]?.str ?? "", status: status)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            RoRoCard(title: "Method") {
                Text("Each factor's raw reading is mapped to a score from −100 (risk-off) to +100 (risk-on) with a fixed piecewise-linear map, weighted within its bucket, and the six buckets are combined with horizon-specific weights. Tactical uses the raw daily composite; Intermediate and Strategic are smoothed with 5- and 20-day exponential averages. Missing factors are re-weighted away rather than treated as zero. The VIX is scored as a contrarian indicator.")
                Text("The score maps are hand-set, not statistically fitted, and the model has not been validated as a predictor of returns. Treat it as a structured summary of conditions, not a forecast.")
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
                    GridRow { Text("Bucket weights"); ForEach(RoRoConfig.bucketKeys, id: \.self) { Text(RoRoConfig.bucketName($0)).font(.caption2) } }
                        .foregroundStyle(.secondary)
                    ForEach(RoRoConfig.horizons, id: \.self) { h in
                        GridRow {
                            Text(RoRoConfig.horizonMeta[h]?.label ?? h)
                            ForEach(RoRoConfig.bucketKeys, id: \.self) { b in Text("\(Int(RoRoConfig.horizonWeights[h]?[b] ?? 0))").monospacedDigit() }
                        }
                    }
                }
                .font(.caption)
            }
            .font(.callout)
        }
    }
}

/// Shows the original self-contained report. Links open in the default browser.
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
