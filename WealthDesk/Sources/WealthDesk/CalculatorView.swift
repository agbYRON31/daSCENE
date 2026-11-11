import AppKit
import Charts
import SwiftUI
import WealthCore

struct CalculatorView: View {
    @EnvironmentObject var state: AppState
    let calc: Calculator

    @State private var projected: Evaluation?
    @State private var computing = false
    @State private var showSave = false

    private var inputs: [String: String] { state.inputs(for: calc) }

    /// Simple calculators evaluate instantly; projections run off the main thread.
    private var evaluation: Evaluation? {
        if calc.projection != nil { return projected }
        return state.engine?.evaluate(calc, inputs: inputs)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                if calc.usesTaxTable { TaxYearBanner() }
                InputsCard(calc: calc, inputs: inputs, errors: evaluation?.fieldErrors ?? [:])
                if let rules = evaluation?.ruleErrors, !rules.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(rules, id: \.self) { Label($0, systemImage: "exclamationmark.triangle.fill") }
                    }
                    .foregroundStyle(.orange)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }
                ResultsCard(calc: calc, evaluation: evaluation, computing: computing)
                if let table = evaluation?.table, evaluation?.isComplete == true {
                    ProjectionCard(calc: calc, table: table)
                }
                DetailsCard(calc: calc)
            }
            .padding(24)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(calc.name)
        .navigationSubtitle(calc.category)
        .toolbar {
            ToolbarItemGroup {
                Button { state.fillSampleNumbers(calc) } label: { Label("Sample numbers", systemImage: "wand.and.stars") }
                    .help("Fill in illustrative sample numbers (not a client's)")
                Button { state.clearInputs(calc) } label: { Label("Clear", systemImage: "eraser") }
                    .help("Clear all inputs")
                Button { copyResults() } label: { Label("Copy results", systemImage: "doc.on.doc") }
                    .help("Copy the results as text")
                    .keyboardShortcut("c", modifiers: [.command, .shift])
                Button {
                    state.copy(state.engine?.excelGrid(calc, inputs: inputs) ?? "",
                               message: "Copied grid. Paste at A1 in Excel.")
                } label: { Label("Copy Excel grid", systemImage: "tablecells") }
                    .help("Copy inputs and live formulas to paste into Excel at A1")
                Button { exportPDF() } label: { Label("PDF report", systemImage: "doc.richtext") }
                    .help("Save a PDF report of these inputs and results to a location you choose")
                    .keyboardShortcut("e")
                Menu {
                    Button("Keep for This Session") { state.snapshotScenario(calc, name: calc.name) }
                    Button("Save Scenario to a File…") { showSave = true }
                    Divider()
                    Button("Open Scenario File…") { state.openScenarioFile() }
                } label: { Label("Save", systemImage: "square.and.arrow.down") }
                    .help("Inputs are not saved automatically. Keep them for this session, or save them to a file you choose.")
                Button { state.toggleFavorite(calc.id) } label: {
                    Label("Favorite", systemImage: state.isFavorite(calc.id) ? "star.fill" : "star")
                }
                .help(state.isFavorite(calc.id) ? "Remove from favorites" : "Add to favorites")
            }
        }
        .sheet(isPresented: $showSave) {
            SaveScenarioSheet(calculatorID: calc.id, title: calc.name, inputs: inputs)
        }
        .task(id: inputs) {
            if calc.projection != nil {
                computing = true
                try? await Task.sleep(nanoseconds: 200_000_000)
                guard !Task.isCancelled, let engine = state.engine else { return }
                let snapshot = inputs
                let calc = self.calc
                let tax = engine.tax
                let result = await Task.detached(priority: .userInitiated) {
                    Engine(calculators: [calc], tax: tax).evaluate(calc, inputs: snapshot)
                }.value
                guard !Task.isCancelled else { return }
                projected = result
                computing = false
            }
            // Record to history once inputs settle.
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled, let e = evaluation else { return }
            state.recordHistory(calc, inputs: inputs, evaluation: e)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(calc.name).font(.title.weight(.semibold))
                if !calc.acronym.isEmpty {
                    Text(calc.acronym)
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Color.wealthAccent.opacity(0.14), in: Capsule())
                        .foregroundStyle(Color.wealthAccent)
                }
            }
            Text(calc.summary).foregroundStyle(.secondary)
            Text(calc.math)
                .font(.system(.callout, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }

    private func exportPDF() {
        guard let e = evaluation, e.isComplete else {
            state.flash("Nothing to report yet. Finish the inputs first.")
            return
        }
        let report = Report(title: calc.name, kind: "Advisor worksheet",
                            sections: [.calculator(calc, inputs: inputs, evaluation: e, tax: state.engine?.tax)])
        ReportRenderer.export(report, state: state)
    }

    private func copyResults() {
        guard let e = evaluation, e.isComplete else {
            state.flash("Nothing to copy yet. Finish the inputs first.")
            return
        }
        var lines = [calc.name]
        for f in calc.fields { lines.append("\(f.label): \(inputs[f.id] ?? "")\(f.isPercent ? "%" : "")") }
        lines.append("")
        for o in e.outputs { lines.append("\(o.label): \(Format.value(o.value, o.format))") }
        state.copy(lines.joined(separator: "\n"))
    }
}

// MARK: - Inputs

struct InputsCard: View {
    @EnvironmentObject var state: AppState
    let calc: Calculator
    let inputs: [String: String]
    let errors: [String: String]

    var body: some View {
        Card(title: "Inputs") {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 12) {
                ForEach(calc.fields) { field in
                    GridRow {
                        Text(field.label)
                            .frame(minWidth: 200, alignment: .leading)
                            .gridColumnAlignment(.leading)
                        VStack(alignment: .leading, spacing: 3) {
                            control(field)
                            if let err = errors[field.id], !(inputs[field.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
                                Text(err).font(.caption).foregroundStyle(.red)
                            } else {
                                Text(field.hint).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    func control(_ field: Field) -> some View {
        let binding = Binding<String>(
            get: { inputs[field.id] ?? "" },
            set: { state.setInput(calc, field.id, $0) }
        )
        if field.isChoice, let options = field.options {
            Picker("", selection: binding) {
                ForEach(options, id: \.value) { opt in
                    Text(opt.label).tag(Format.plain(opt.value))
                }
            }
            .labelsHidden()
            .frame(maxWidth: 260, alignment: .leading)
        } else if field.isSeries {
            TextField("e.g. " + field.example, text: binding, axis: .vertical)
                .lineLimit(1...4)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))
        } else {
            HStack(spacing: 6) {
                // Fixed-width prefix slot keeps every input box aligned.
                Text(field.unit == "$" ? "$" : "")
                    .foregroundStyle(.secondary)
                    .frame(width: 10, alignment: .trailing)
                TextField("", text: binding)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 220)
                    .multilineTextAlignment(.trailing)
                if let suffix = unitSuffix(field) { Text(suffix).foregroundStyle(.secondary) }
            }
        }
    }

    func unitSuffix(_ f: Field) -> String? {
        switch f.unit {
        case "%": return "%"
        case "years": return "years"
        case "age": return "years old"
        default: return nil
        }
    }
}

// MARK: - Results

struct ResultsCard: View {
    @EnvironmentObject var state: AppState
    let calc: Calculator
    let evaluation: Evaluation?
    let computing: Bool

    var body: some View {
        Card(title: "Results", trailing: computing ? AnyView(ProgressView().controlSize(.small)) : nil) {
            if let e = evaluation, e.isComplete {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                    ForEach(e.outputs) { o in
                        ResultTile(output: o, note: note(for: o))
                            .onTapGesture {
                                guard let v = o.value, !v.isNaN else { return }
                                state.copy(Format.value(v, o.format), message: "Copied \(o.label.lowercased()).")
                            }
                    }
                }
                Text("Click a result to copy it.").font(.caption).foregroundStyle(.tertiary)
            } else if evaluation == nil && calc.projection != nil {
                Text("Calculating…").foregroundStyle(.secondary)
            } else {
                Text("Enter your numbers above. Results appear as soon as every field is filled in.").foregroundStyle(.secondary)
            }
        }
    }

    func note(for o: OutputResult) -> String? {
        if let v = o.value, v.isNaN, o.label.lowercased().contains("bracket") { return "Top bracket: no upper limit." }
        if o.format == "age", let v = o.value, v < 0 { return "Money lasts through the plan." }
        return o.error
    }
}

struct ResultTile: View {
    let output: OutputResult
    let note: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(output.label).font(.callout).foregroundStyle(.secondary).lineLimit(2)
            Text(Format.value(output.value, output.format))
                .font(.system(size: 24, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(isNegative ? Color.red : Color.primary)
                .textSelection(.enabled)
            if let note { Text(note).font(.caption).foregroundStyle(.secondary) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
    }

    var isNegative: Bool { (output.value ?? 0) < 0 && output.format != "age" }
}

// MARK: - Projection chart and table

struct ProjectionCard: View {
    @EnvironmentObject var state: AppState
    let calc: Calculator
    let table: TableResult
    @State private var showTable = false

    struct Point: Identifiable {
        let id = UUID()
        let x: Double
        let y: Double
        let series: String
    }

    var points: [Point] {
        var out: [Point] = []
        for row in table.rows {
            for c in table.spec.chartColumns {
                out.append(Point(x: row[0], y: row[c], series: table.spec.columns[c].label))
            }
        }
        return out
    }

    var body: some View {
        Card(title: calc.projection == "montecarlo" ? "Balance range across simulations" : "Year by year",
             trailing: AnyView(
                Button("Copy table") {
                    state.copy(state.engine?.tableTSV(table) ?? "", message: "Copied table. Paste into Excel.")
                }.buttonStyle(.link))) {
            Chart(points) { p in
                LineMark(x: .value(table.spec.columns[0].label, p.x),
                         y: .value("Balance", p.y))
                    .foregroundStyle(by: .value("Series", p.series))
                    .interpolationMethod(.monotone)
            }
            .chartForegroundStyleScale(range: [Color.orange, Color.wealthAccent, Color.blue])
            .chartYAxis {
                AxisMarks { v in
                    AxisGridLine()
                    AxisValueLabel {
                        if let d = v.as(Double.self) { Text(compact(d)) }
                    }
                }
            }
            .chartXAxisLabel(table.spec.columns[0].label)
            .chartXScale(domain: .automatic(includesZero: false))
            .frame(height: 240)

            DisclosureGroup(isExpanded: $showTable) {
                ScrollView(.horizontal) {
                    Grid(alignment: .trailing, horizontalSpacing: 18, verticalSpacing: 4) {
                        GridRow {
                            ForEach(table.spec.columns, id: \.label) { col in
                                Text(col.label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            }
                        }
                        Divider()
                        ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                            GridRow {
                                ForEach(Array(row.enumerated()), id: \.offset) { i, v in
                                    Text(Format.value(v, table.spec.columns[i].format))
                                        .monospacedDigit().font(.callout)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 6)
                }
            } label: {
                Text("Show table (\(table.rows.count) rows)").font(.callout)
            }
        }
    }

    func compact(_ v: Double) -> String {
        let a = abs(v)
        if a >= 1e9 { return String(format: "$%.1fB", v / 1e9) }
        if a >= 1e6 { return String(format: "$%.1fM", v / 1e6) }
        if a >= 1e3 { return String(format: "$%.0fK", v / 1e3) }
        return String(format: "$%.0f", v)
    }
}

// MARK: - Details

struct DetailsCard: View {
    @EnvironmentObject var state: AppState
    let calc: Calculator
    @State private var expanded = false

    var body: some View {
        Card(title: "Details & Excel") {
            DisclosureGroup(isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 14) {
                    section("Assumptions", calc.assumptions)
                    section("How to read it", calc.interpretation)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Excel").font(.headline)
                        ForEach(calc.outputs) { o in
                            HStack(alignment: .firstTextBaseline) {
                                Text(o.label).foregroundStyle(.secondary).frame(width: 220, alignment: .leading)
                                Text(state.engine?.excelFormula(calc, o) ?? "No single-cell formula")
                                    .font(.system(.callout, design: .monospaced))
                                    .textSelection(.enabled)
                            }
                        }
                        Text("Formulas assume the copied grid is pasted at A1 (inputs in column B, starting at row 2).")
                            .font(.caption).foregroundStyle(.secondary)
                        Text(calc.excelNotes).font(.caption).foregroundStyle(.secondary)
                    }
                    if !calc.sources.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Sources").font(.headline)
                            ForEach(calc.sources, id: \.url) { s in
                                if let url = URL(string: s.url) { Link(s.title, destination: url) }
                            }
                        }
                    }
                }
                .padding(.top, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
            } label: {
                Text("Assumptions, interpretation, Excel formulas and sources").font(.callout)
            }
        }
    }

    func section(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            Text(body).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Card

struct Card<Content: View>: View {
    let title: String
    var trailing: AnyView? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                if let trailing { trailing }
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.primary.opacity(0.08)))
    }
}


// MARK: - Tax year banner & panel

/// Shown on calculators that read the IRS tax table: year picker, provenance, and any IRS.gov warnings.
struct TaxYearBanner: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        if let t = state.taxTable {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.seal").foregroundStyle(Color.wealthAccent)
                    Text("IRS figures for tax year")
                    Picker("", selection: Binding(get: { t.taxYear }, set: { state.setTaxYear($0) })) {
                        ForEach(state.taxYears, id: \.self) { Text(String($0)).tag($0) }
                    }
                    .labelsHidden()
                    .fixedSize()
                    Text("· verified \(TaxDataPanel.prettyDate(t.verifiedOn)) against \(t.sources.first?.title.components(separatedBy: " (").first ?? "IRS publications")")
                        .foregroundStyle(.secondary)
                }
                .font(.callout)
                ForEach(t.notes, id: \.self) { note in
                    Label(note, systemImage: "info.circle").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(state.irsWarnings, id: \.self) { w in
                    Label(w, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.orange)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.wealthAccent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
        }
    }
}

/// Settings section: choose the year, see exactly which IRS documents back it, and run the IRS.gov check.
struct TaxDataPanel: View {
    @EnvironmentObject var state: AppState

    static func prettyDate(_ ymd: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        guard let d = f.date(from: ymd) else { return ymd }
        return d.formatted(date: .abbreviated, time: .omitted)
    }

    var body: some View {
        if let t = state.taxTable {
            Picker("Tax year", selection: Binding(get: { t.taxYear }, set: { state.setTaxYear($0) })) {
                ForEach(state.taxYears, id: \.self) { Text(String($0)).tag($0) }
            }
            LabeledContent("Verified against IRS on", value: Self.prettyDate(t.verifiedOn))
            VStack(alignment: .leading, spacing: 4) {
                ForEach(t.sources, id: \.url) { s in
                    if let u = URL(string: s.url) { Link(s.title, destination: u).font(.caption) }
                }
            }
            ForEach(t.notes, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
            if t.limitsYear != t.taxYear {
                Text("401(k)/IRA limits shown are the \(String(t.limitsYear)) limits.").font(.caption).foregroundStyle(.secondary)
            }
        }
        Toggle("Check IRS.gov for newer tax figures at launch (once a day)", isOn: $state.prefs.checkIRS)
        HStack {
            Button(state.irsChecking ? "Checking…" : "Check IRS.gov now") {
                Task { await state.checkIRS(force: true) }
            }
            .disabled(state.irsChecking)
            if let at = state.prefs.irsCheckedAt {
                Text("Last checked \(at.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary)
            }
        }
        if let err = state.irsError {
            Label(err, systemImage: "wifi.exclamationmark").font(.caption).foregroundStyle(.secondary)
        } else if state.prefs.irsCheckedAt != nil {
            let warnings = state.irsWarnings
            if warnings.isEmpty {
                Label("Up to date with the newest IRS releases.", systemImage: "checkmark.circle").font(.caption).foregroundStyle(.green)
            } else {
                ForEach(warnings, id: \.self) { Label($0, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.orange) }
            }
        }
        Text("The check reads public IRS.gov release pages only; nothing about you is sent.")
            .font(.caption2).foregroundStyle(.tertiary)
    }
}
