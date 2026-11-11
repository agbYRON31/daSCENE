import AppKit
import Charts
import SwiftUI
import UniformTypeIdentifiers
import WealthCore

// Local PDF reports. A report is built only when the user asks for one and is written only to
// the file they choose. It contains the assumptions typed in, the results, a chart, and the
// method, sources and limitations. It never contains a name or account identifier.

struct ReportSection: Identifiable {
    let id = UUID()
    var title: String
    var summary = ""
    var inputs: [(label: String, value: String)] = []
    var results: [(label: String, value: String)] = []
    var chart: AnyView? = nil
    var chartCaption = ""
    var tableHeaders: [String] = []
    var tableRows: [[String]] = []
    var notes: [(title: String, text: String)] = []
}

struct Report {
    var title: String
    var kind: String
    var sections: [ReportSection]
    var dataNotes: [String] = []
    var generated = Date()

    static let disclaimer = """
    This report is a hypothetical illustration produced by Wealth Desk from the assumptions shown, which were entered by the user. \
    It is for education and discussion only. It is not investment, tax or legal advice, not a recommendation, and not a forecast or \
    guarantee of future results. Actual results will differ. Deterministic what-if scenarios show the effect of the stated assumptions \
    and say nothing about how likely they are. Wealth Desk is an independent application and is not affiliated with, endorsed by, or \
    approved by Morgan Stanley or any other financial institution.
    """
}

@MainActor
extension ReportSection {
    /// A section for one catalog calculator: what was entered, the results, chart/table, and methodology.
    static func calculator(_ calc: Calculator, inputs: [String: String], evaluation: Evaluation,
                           title: String? = nil, labels: [String: String] = [:], tax: TaxTable?) -> ReportSection {
        var s = ReportSection(title: title ?? calc.name, summary: calc.summary)
        for f in calc.fields {
            let raw = (inputs[f.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            s.inputs.append((labels[f.id] ?? f.label, display(raw, field: f)))
        }
        for o in evaluation.outputs {
            var text = Format.value(o.value, o.format)
            if o.format == "age", let v = o.value, v < 0 { text = "Does not run out in the plan" }
            if let v = o.value, v.isNaN { text = "Not applicable" }
            if o.value == nil { text = o.error ?? "—" }
            s.results.append((o.label, text))
        }
        if let table = evaluation.table, !table.rows.isEmpty {
            s.chart = AnyView(ProjectionChart(table: table).frame(height: 190))
            s.chartCaption = table.spec.chartColumns.map { table.spec.columns[$0].label }.joined(separator: " · ")
            s.tableHeaders = table.spec.columns.map(\.label)
            s.tableRows = table.rows.map { row in row.enumerated().map { Format.value($1, table.spec.columns[$0].format) } }
        }
        s.notes.append(("Method", calc.math))
        s.notes.append(("Assumptions", calc.assumptions))
        s.notes.append(("How to read it", calc.interpretation))
        if calc.usesTaxTable, let t = tax {
            s.notes.append(("Tax data", "IRS figures for tax year \(t.taxYear), verified \(t.verifiedOn) against: "
                            + t.sources.map(\.title).joined(separator: "; ") + "." + (t.notes.isEmpty ? "" : " " + t.notes.joined(separator: " "))))
        }
        if !calc.sources.isEmpty {
            s.notes.append(("Sources", calc.sources.map { "\($0.title) — \($0.url)" }.joined(separator: "\n")))
        }
        return s
    }

    static func display(_ raw: String, field f: Field) -> String {
        guard !raw.isEmpty else { return "—" }
        if f.isChoice, let v = Double(raw), let opt = f.options?.first(where: { $0.value == v }) { return opt.label }
        if f.isSeries { return raw.replacingOccurrences(of: "\n", with: "; ") }
        guard case .number(let v)? = try? Engine.parse(raw, field: f) else { return raw }
        switch f.unit {
        case "$": return Format.currency(v)
        case "%": return Format.percent(v)
        case "years": return Format.plain(v, maxDecimals: 2) + " years"
        case "age": return "age " + Format.plain(v, maxDecimals: 0)
        default: return Format.plain(v, maxDecimals: 6)
        }
    }
}

/// The line chart used for projection tables, shared by the app and reports.
struct ProjectionChart: View {
    let table: TableResult

    struct Point: Identifiable {
        let id = UUID()
        let x: Double
        let y: Double
        let series: String
    }

    var points: [Point] {
        table.rows.flatMap { row in table.spec.chartColumns.map { Point(x: row[0], y: row[$0], series: table.spec.columns[$0].label) } }
    }

    var body: some View {
        Chart(points) { p in
            LineMark(x: .value(table.spec.columns[0].label, p.x), y: .value("Value", p.y))
                .foregroundStyle(by: .value("Series", p.series))
                .interpolationMethod(.monotone)
        }
        .chartForegroundStyleScale(range: [Color.orange, Color.wealthAccent, Color.blue])
        .chartYAxis {
            AxisMarks { v in
                AxisGridLine()
                AxisValueLabel { if let d = v.as(Double.self) { Text(Money.compact(d)) } }
            }
        }
        .chartXAxisLabel(table.spec.columns[0].label)
        .chartXScale(domain: .automatic(includesZero: false))
    }
}

enum Money {
    static func compact(_ v: Double) -> String {
        let a = abs(v), sign = v < 0 ? "−" : ""
        if a >= 1e9 { return sign + String(format: "$%.1fB", a / 1e9) }
        if a >= 1e6 { return sign + String(format: "$%.1fM", a / 1e6) }
        if a >= 1e3 { return sign + String(format: "$%.0fK", a / 1e3) }
        return sign + String(format: "$%.0f", a)
    }
}

// MARK: - Page layout

@MainActor
enum ReportRenderer {
    static let page = CGSize(width: 612, height: 792)       // US Letter, points
    static let margin: CGFloat = 46
    static let footerHeight: CGFloat = 40
    static var contentWidth: CGFloat { page.width - 2 * margin }
    static var contentHeight: CGFloat { page.height - 2 * margin - footerHeight }
    static let rowsPerTableBlock = 26

    static func blocks(_ r: Report) -> [AnyView] {
        var out: [AnyView] = [AnyView(ReportHeader(report: r))]
        for s in r.sections {
            out.append(AnyView(VStack(alignment: .leading, spacing: 10) {
                Text(s.title).font(.system(size: 15, weight: .semibold))
                if !s.summary.isEmpty { Text(s.summary).font(.system(size: 9.5)).foregroundColor(.gray) }
                KeyValueTable(title: "Assumptions entered", rows: s.inputs, emphasize: false)
            }))
            if !s.results.isEmpty { out.append(AnyView(KeyValueTable(title: "Results", rows: s.results, emphasize: true))) }
            if let chart = s.chart {
                out.append(AnyView(VStack(alignment: .leading, spacing: 4) {
                    Text("Chart").font(.system(size: 8, weight: .semibold)).foregroundColor(.gray).textCase(.uppercase)
                    chart
                    if !s.chartCaption.isEmpty { Text(s.chartCaption).font(.system(size: 8)).foregroundColor(.gray) }
                }))
            }
            if !s.tableRows.isEmpty {
                var start = 0
                while start < s.tableRows.count {
                    let end = min(start + rowsPerTableBlock, s.tableRows.count)
                    out.append(AnyView(DataTable(headers: s.tableHeaders, rows: Array(s.tableRows[start..<end]), continued: start > 0)))
                    start = end
                }
            }
            for n in s.notes where !n.text.isEmpty {
                out.append(AnyView(VStack(alignment: .leading, spacing: 3) {
                    Text(n.title).font(.system(size: 8, weight: .semibold)).foregroundColor(.gray).textCase(.uppercase)
                    Text(n.text).font(.system(size: 9)).fixedSize(horizontal: false, vertical: true)
                }))
            }
        }
        if !r.dataNotes.isEmpty {
            out.append(AnyView(VStack(alignment: .leading, spacing: 3) {
                Text("Data sources and dates").font(.system(size: 8, weight: .semibold)).foregroundColor(.gray).textCase(.uppercase)
                ForEach(r.dataNotes, id: \.self) { Text("• " + $0).font(.system(size: 9)).fixedSize(horizontal: false, vertical: true) }
            }))
        }
        out.append(AnyView(VStack(alignment: .leading, spacing: 3) {
            Text("Important information").font(.system(size: 8, weight: .semibold)).foregroundColor(.gray).textCase(.uppercase)
            Text(Report.disclaimer).font(.system(size: 8.5)).fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .background(Color(white: 0.95))))
        return out
    }

    static func renderer(_ view: AnyView, width: CGFloat) -> ImageRenderer<some View> {
        let r = ImageRenderer(content: view
            .frame(width: width, alignment: .leading)
            .foregroundColor(.black)
            .environment(\.colorScheme, .light))
        r.proposedSize = ProposedViewSize(width: width, height: nil)
        return r
    }

    static func pdf(_ report: Report) -> Data {
        let views = blocks(report)
        var heights: [CGFloat] = []
        for v in views {
            var h: CGFloat = 0
            renderer(v, width: contentWidth).render { size, _ in h = size.height }
            heights.append(h)
        }
        // Pack blocks into pages.
        let gap: CGFloat = 14
        var pages: [[Int]] = [[]]
        var used: CGFloat = 0
        for i in views.indices {
            let need = heights[i] + (pages[pages.count - 1].isEmpty ? 0 : gap)
            if used + need > contentHeight, !pages[pages.count - 1].isEmpty {
                pages.append([])
                used = 0
            }
            used += heights[i] + (pages[pages.count - 1].isEmpty ? 0 : gap)
            pages[pages.count - 1].append(i)
        }
        let data = NSMutableData()
        var box = CGRect(origin: .zero, size: page)
        let info = [kCGPDFContextTitle: report.title, kCGPDFContextCreator: "Wealth Desk"] as CFDictionary
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let ctx = CGContext(consumer: consumer, mediaBox: &box, info) else { return Data() }
        for (p, items) in pages.enumerated() {
            ctx.beginPDFPage(nil)
            var y = margin
            for i in items {
                let h = heights[i]
                // Scale down a block that is taller than a page rather than cutting it off.
                let scale = h > contentHeight ? contentHeight / h : 1
                ctx.saveGState()
                ctx.translateBy(x: margin, y: page.height - y - h * scale)
                ctx.scaleBy(x: scale, y: scale)
                renderer(views[i], width: contentWidth).render { _, draw in draw(ctx) }
                ctx.restoreGState()
                y += h * scale + gap
            }
            let footer = AnyView(ReportFooter(page: p + 1, pages: pages.count, generated: report.generated))
            ctx.saveGState()
            ctx.translateBy(x: margin, y: margin * 0.6)
            renderer(footer, width: contentWidth).render { _, draw in draw(ctx) }
            ctx.restoreGState()
            ctx.endPDFPage()
        }
        ctx.closePDF()
        return data as Data
    }

    /// Asks where to save, then writes the PDF there. Nothing is sent anywhere.
    static func export(_ report: Report, state: AppState) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = "Wealth Desk - \(report.title).pdf".replacingOccurrences(of: "/", with: "-")
        panel.message = "The report is saved only to the location you choose. It contains the numbers entered in this session."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let data = pdf(report)
        do {
            guard !data.isEmpty else { throw EvalError.message("The report could not be rendered.") }
            try data.write(to: url, options: .atomic)
            state.flash("Report saved.")
        } catch {
            state.flash("Couldn't save the report: \(error.localizedDescription)")
        }
    }
}

struct ReportHeader: View {
    let report: Report
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("WEALTH DESK").font(.system(size: 10, weight: .bold)).tracking(1.6).foregroundColor(Color.wealthAccent)
                Spacer()
                Text(report.kind.uppercased()).font(.system(size: 8, weight: .semibold)).tracking(1).foregroundColor(.gray)
            }
            Rectangle().fill(Color.wealthAccent).frame(height: 2)
            Text(report.title).font(.system(size: 22, weight: .semibold)).padding(.top, 6)
            Text("Hypothetical illustration based on assumptions entered by the user · Generated \(report.generated.formatted(date: .long, time: .shortened))")
                .font(.system(size: 9)).foregroundColor(.gray)
        }
    }
}

struct ReportFooter: View {
    let page: Int
    let pages: Int
    let generated: Date
    var body: some View {
        VStack(spacing: 4) {
            Rectangle().fill(Color(white: 0.8)).frame(height: 0.5)
            HStack {
                Text("Wealth Desk · Hypothetical illustration. Not investment, tax or legal advice. Not affiliated with or endorsed by Morgan Stanley.")
                Spacer()
                Text("Page \(page) of \(pages)")
            }
            .font(.system(size: 7.5)).foregroundColor(.gray)
        }
    }
}

struct KeyValueTable: View {
    let title: String
    let rows: [(label: String, value: String)]
    let emphasize: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.system(size: 8, weight: .semibold)).foregroundColor(.gray).textCase(.uppercase).padding(.bottom, 4)
            ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                HStack(alignment: .firstTextBaseline) {
                    Text(r.label).font(.system(size: 10))
                    Spacer(minLength: 12)
                    Text(r.value).font(.system(size: 10, weight: emphasize ? .semibold : .regular)).monospacedDigit().multilineTextAlignment(.trailing)
                }
                .padding(.vertical, 3.5).padding(.horizontal, 6)
                .background(i % 2 == 0 ? Color(white: 0.96) : Color.white)
            }
        }
    }
}

struct DataTable: View {
    let headers: [String]
    let rows: [[String]]
    let continued: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(continued ? "Year-by-year table (continued)" : "Year-by-year table")
                .font(.system(size: 8, weight: .semibold)).foregroundColor(.gray).textCase(.uppercase).padding(.bottom, 4)
            row(headers, bold: true).background(Color(white: 0.9))
            ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                row(r, bold: false).background(i % 2 == 0 ? Color.white : Color(white: 0.96))
            }
        }
    }

    func row(_ cells: [String], bold: Bool) -> some View {
        HStack(spacing: 4) {
            ForEach(Array(cells.enumerated()), id: \.offset) { i, c in
                Text(c).font(.system(size: 8.5, weight: bold ? .semibold : .regular)).monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: i == 0 ? .leading : .trailing)
            }
        }
        .padding(.vertical, 2.5).padding(.horizontal, 6)
    }
}
