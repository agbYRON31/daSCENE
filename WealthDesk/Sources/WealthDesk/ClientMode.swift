import Charts
import SwiftUI
import WealthCore

// Client Mode: five plain-language tools. Every number shown comes from the same audited
// catalog calculators Advisor Mode uses; this file only chooses which inputs to show, how to
// label them, and how to draw the result. Nothing is pre-filled: amounts start empty.

struct ClientField {
    let id: String
    let label: String
    let range: ClosedRange<Double>      // slider range, in the units the user types
    let step: Double
    /// Used when the box is left empty (shown as the placeholder). Only for optional items
    /// where "none" is natural, never for a balance.
    var blank: String? = nil
}

/// One calculator evaluated for Client Mode.
struct ClientCalc {
    let calc: Calculator
    let inputs: [String: String]
    let eval: Evaluation
    let labels: [String: String]

    var ok: Bool { eval.isComplete }
    func v(_ i: Int) -> Double { eval.outputs.indices.contains(i) ? (eval.outputs[i].value ?? .nan) : .nan }

    /// Labels of the boxes that still need a number.
    var missing: [String] {
        calc.fields.filter { eval.fieldErrors[$0.id] != nil && (inputs[$0.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
            .map { labels[$0.id] ?? $0.label }
    }

    /// Entries that are present but not usable, plus rule violations.
    var problems: [String] {
        calc.fields.compactMap { f -> String? in
            guard let e = eval.fieldErrors[f.id], !(inputs[f.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return "\(labels[f.id] ?? f.label): \(e)"
        } + eval.ruleErrors
    }
}

@MainActor
extension AppState {
    func clientRaw(_ key: String, _ id: String) -> String { session.working[key]?[id] ?? "" }

    func setClient(_ key: String, _ id: String, _ value: String) {
        session.working[key, default: [:]][id] = value
    }

    /// Evaluates a catalog calculator from a Client Mode input store.
    func clientRun(_ key: String, _ calcID: String, _ fields: [ClientField], overrides: [String: String] = [:]) -> ClientCalc? {
        guard let engine, let calc = calculator(calcID) else { return nil }
        var inputs = calc.blankInputs
        for f in calc.fields {
            let typed = (overrides[f.id] ?? clientRaw(key, f.id)).trimmingCharacters(in: .whitespaces)
            if !typed.isEmpty { inputs[f.id] = typed } else if let b = fields.first(where: { $0.id == f.id })?.blank { inputs[f.id] = b }
        }
        let labels = Dictionary(uniqueKeysWithValues: fields.map { ($0.id, $0.label) })
        return ClientCalc(calc: calc, inputs: inputs, eval: engine.evaluate(calc, inputs: inputs), labels: labels)
    }

    /// Carries the numbers into the full Advisor Mode calculator.
    func openInAdvisor(_ c: ClientCalc) {
        session.working[c.calc.id] = c.inputs
        showInAdvisor(c.calc.id)
    }
}

// MARK: - Tool definitions

enum ClientSpec {
    static let growth: [ClientField] = [
        .init(id: "p", label: "Starting amount", range: 0...2_000_000, step: 5_000, blank: "0"),
        .init(id: "m", label: "Added each month", range: 0...10_000, step: 50, blank: "0"),
        .init(id: "wd", label: "Taken out each month", range: 0...20_000, step: 100, blank: "0"),
        .init(id: "r", label: "Yearly return", range: 0...12, step: 0.25),
        .init(id: "y", label: "Years", range: 1...50, step: 1),
        .init(id: "infl", label: "Inflation", range: 0...8, step: 0.25, blank: "0"),
    ]
    static let retirementYou: [ClientField] = [
        .init(id: "age", label: "Age today", range: 18...90, step: 1),
        .init(id: "retire", label: "Retirement age", range: 40...80, step: 1),
        .init(id: "bal", label: "Invested today", range: 0...5_000_000, step: 10_000, blank: "0"),
        .init(id: "c", label: "Saved per year until retirement", range: 0...200_000, step: 1_000, blank: "0"),
        .init(id: "spend", label: "Yearly spending in retirement (today's dollars)", range: 0...500_000, step: 5_000),
        .init(id: "other", label: "Other yearly retirement income (Social Security, pension)", range: 0...200_000, step: 1_000, blank: "0"),
    ]
    static let retirementAssumptions: [ClientField] = [
        .init(id: "rpre", label: "Yearly return before retirement", range: 0...12, step: 0.25),
        .init(id: "rpost", label: "Yearly return in retirement", range: 0...12, step: 0.25),
        .init(id: "infl", label: "Inflation", range: 0...8, step: 0.25),
        .init(id: "plan", label: "Plan through age", range: 70...110, step: 1, blank: "95"),
        .init(id: "oage", label: "Other income starts at age", range: 55...75, step: 1, blank: "67"),
        .init(id: "cg", label: "Yearly increase in saving", range: 0...10, step: 0.5, blank: "0"),
        .init(id: "wtax", label: "Tax rate on withdrawals (0 for Roth or after-tax money)", range: 0...50, step: 1, blank: "0"),
        .init(id: "sd", label: "Market ups and downs (volatility)", range: 0...30, step: 1),
    ]
    static var retirement: [ClientField] { retirementYou + retirementAssumptions }
    static let risk: [ClientField] = [
        .init(id: "v", label: "Portfolio value", range: 0...10_000_000, step: 50_000),
        .init(id: "we", label: "Stocks", range: 0...100, step: 5),
        .init(id: "wb", label: "Bonds", range: 0...100, step: 5),
        .init(id: "eq", label: "Stock market change", range: -60...40, step: 1),
        .init(id: "dy", label: "Interest-rate change", range: -3...3, step: 0.25, blank: "0"),
        .init(id: "dur", label: "Bond duration (years of rate sensitivity)", range: 0...15, step: 0.5, blank: "6"),
        .init(id: "infl", label: "Inflation over the period", range: 0...10, step: 0.5, blank: "0"),
        .init(id: "w", label: "Withdrawal during the period", range: 0...500_000, step: 5_000, blank: "0"),
    ]
    static let volatility: [ClientField] = [
        .init(id: "sa", label: "Stock volatility", range: 0...40, step: 1),
        .init(id: "sb", label: "Bond volatility", range: 0...20, step: 0.5),
        .init(id: "rho", label: "How stocks and bonds move together (−1 to 1)", range: -1...1, step: 0.05),
    ]
    static let decisionLevers: [ClientField] = [
        .init(id: "retire", label: "Retirement age", range: 40...80, step: 1),
        .init(id: "c", label: "Saved per year", range: 0...200_000, step: 1_000),
        .init(id: "spend", label: "Yearly retirement spending", range: 0...500_000, step: 5_000),
        .init(id: "rpre", label: "Return before retirement", range: 0...12, step: 0.25),
    ]
    static let inflation: [ClientField] = [
        .init(id: "c", label: "Amount in today's dollars", range: 0...1_000_000, step: 1_000),
        .init(id: "i", label: "Inflation", range: 0...10, step: 0.25),
        .init(id: "n", label: "Years", range: 1...50, step: 1),
    ]
    static let taxDrag: [ClientField] = [
        .init(id: "a", label: "Amount invested", range: 0...2_000_000, step: 5_000),
        .init(id: "r", label: "Yearly return", range: 0...12, step: 0.25),
        .init(id: "t", label: "Tax rate on investment earnings", range: 0...50, step: 1),
        .init(id: "n", label: "Years", range: 1...50, step: 1),
    ]
    static let incomeTax: [ClientField] = [
        .init(id: "ti", label: "Taxable income", range: 0...2_000_000, step: 5_000),
    ]

    static func title(_ t: ClientTool) -> String {
        switch t {
        case .growth: return "How much could I save?"
        case .retirement: return "Am I on track for retirement?"
        case .risk: return "What if markets fall?"
        case .decisions: return "Compare two plans"
        case .taxes: return "Taxes & purchasing power"
        case .market: return "Market brief"
        }
    }

    static func blurb(_ t: ClientTool) -> String {
        switch t {
        case .growth: return "See what regular saving and compound growth can add up to."
        case .retirement: return "Project savings to and through retirement, and how long they could last."
        case .risk: return "See what a market drop or a rate change would do to a portfolio mix."
        case .decisions: return "Compare two choices side by side: retire earlier, save more, spend less."
        case .taxes: return "See what inflation does to buying power and what taxes take from growth."
        case .market: return "A plain summary of today's economic and market backdrop from public data."
        }
    }

    static func symbol(_ t: ClientTool) -> String {
        switch t {
        case .growth: return "chart.line.uptrend.xyaxis"
        case .retirement: return "figure.walk"
        case .risk: return "shield.lefthalf.filled"
        case .decisions: return "arrow.triangle.branch"
        case .taxes: return "percent"
        case .market: return "gauge.medium"
        }
    }
}

// MARK: - Shell

struct ClientModeView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        NavigationStack {
            Group {
                switch state.clientTool {
                case nil: ClientHome()
                case .growth?: GrowthTool()
                case .retirement?: RetirementTool()
                case .risk?: RiskTool()
                case .decisions?: DecisionsTool()
                case .taxes?: TaxesTool()
                case .market?: ClientMarketView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.wealthPaper)
            .navigationTitle(state.clientTool.map(ClientSpec.title) ?? "Wealth Desk")
            .navigationSubtitle("Client Mode")
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    if state.clientTool != nil {
                        Button { state.clientTool = nil } label: { Label("Planning tools", systemImage: "chevron.left") }
                            .help("Back to all the questions")
                    }
                }
                ToolbarItem(placement: .navigation) { ModeSwitch() }
                ToolbarItemGroup {
                    if let tool = state.clientTool, tool != .market {
                        Button { exportPDF() } label: { Label("PDF report", systemImage: "doc.richtext") }
                            .help("Save a PDF of this illustration to a location you choose")
                    }
                    Button { state.clearSession() } label: { Label("Clear", systemImage: "eraser") }
                        .help("Erase everything typed this session")
                }
            }
        }
    }

    private func exportPDF() {
        guard let tool = state.clientTool else { return }
        let calcs = ClientReports.calcs(for: tool, state: state).filter(\.1.ok)
        guard !calcs.isEmpty else {
            state.flash("Nothing to report yet. Fill in the numbers first.")
            return
        }
        let sections = calcs.map { ReportSection.calculator($0.1.calc, inputs: $0.1.inputs, evaluation: $0.1.eval,
                                                           title: $0.0, labels: $0.1.labels, tax: state.engine?.tax) }
        ReportRenderer.export(Report(title: ClientSpec.title(tool), kind: "Client illustration", sections: sections), state: state)
    }
}

@MainActor
enum ClientReports {
    /// The calculators behind each tool, with the title each gets in a report.
    static func calcs(for tool: ClientTool, state: AppState) -> [(String, ClientCalc)] {
        var out: [(String, ClientCalc?)] = []
        switch tool {
        case .growth:
            out = [("Investment growth", state.clientRun("client.growth", "growth_schedule", ClientSpec.growth))]
        case .retirement:
            out = [("Retirement projection", state.clientRun("client.retirement", "retirement_timeline", ClientSpec.retirement)),
                   ("Range of outcomes (Monte Carlo simulation)", state.clientRun("client.retirement", "retirement_mc", ClientSpec.retirement))]
        case .risk:
            out = [("What-if scenario", state.clientRun("client.risk", "portfolio_stress", ClientSpec.risk)),
                   ("Volatility of the mix", RiskTool.volatility(state))]
            if !state.clientRaw("client.risk.B", "we").isEmpty || !state.clientRaw("client.risk.B", "wb").isEmpty {
                out.insert(("What-if scenario: comparison mix", RiskTool.mixB(state)), at: 1)
            }
        case .decisions:
            out = [("Option A", state.clientRun("client.retirement", "retirement_timeline", ClientSpec.retirement)),
                   ("Option B", DecisionsTool.optionB(state))]
        case .market:
            out = []
        case .taxes:
            out = [("Inflation and buying power", state.clientRun("client.inflation", "inflation_cost", ClientSpec.inflation)),
                   ("Taxes on investment growth", state.clientRun("client.taxdrag", "tax_deferral", ClientSpec.taxDrag)),
                   ("Federal income tax estimate", state.clientRun("client.incometax", "income_tax", ClientSpec.incomeTax))]
        }
        return out.compactMap { t, c in c.map { (t, $0) } }
    }
}

/// Client home: six questions in two columns separated by thin rules. No icons or blurbs, so the
/// questions themselves are what the client reads. Mirrors clientHome() in web/app.js.
struct ClientHome: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                let one = geo.size.width < 640
                VStack(alignment: .leading, spacing: 0) {
                    Text("Planning tools").font(.system(size: 28, weight: .semibold)).foregroundStyle(Color.wealthInk)
                    Rectangle().fill(Color.wealthInk).frame(height: 1).padding(.top, 26)
                    let tools = ClientTool.allCases
                    if one {
                        VStack(spacing: 0) { ForEach(tools) { PlanningRow(tool: $0, compact: true) } }
                    } else {
                        Grid(horizontalSpacing: 56, verticalSpacing: 0) {
                            ForEach(0..<(tools.count + 1) / 2, id: \.self) { r in
                                GridRow {
                                    PlanningRow(tool: tools[r * 2])
                                    if r * 2 + 1 < tools.count { PlanningRow(tool: tools[r * 2 + 1]) } else { Color.clear }
                                }
                            }
                        }
                    }
                    ClientFootnote().padding(.top, 24)
                }
                .padding(.horizontal, one ? 16 : 32).padding(.top, one ? 24 : 36).padding(.bottom, 40)
                .frame(maxWidth: 1040, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

/// One question on the client home: the label and an arrow, with a thin rule underneath.
struct PlanningRow: View {
    @EnvironmentObject var state: AppState
    let tool: ClientTool
    var compact = false
    @State private var hover = false

    var body: some View {
        Button { state.clientTool = tool } label: {
            HStack(spacing: 16) {
                Text(ClientSpec.title(tool)).font(.system(size: compact ? 19 : 21, weight: .medium))
                    .foregroundStyle(hover ? Color.wealthAccentText : Color.wealthInk)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                Text("→").font(.system(size: 20)).foregroundStyle(hover ? Color.wealthAccentText : Color.secondary)
                    .offset(x: hover ? 3 : 0)
            }
            .padding(.vertical, compact ? 20 : 26).padding(.horizontal, compact ? 2 : 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(.easeOut(duration: 0.15)) { hover = h } }
        .accessibilityLabel(ClientSpec.title(tool))
    }
}

struct ClientFootnote: View {
    var body: some View {
        Text("These are educational illustrations based only on the numbers typed in. They are not advice, a recommendation or a prediction. Nothing typed here is saved or sent; it is erased when Wealth Desk quits.")
            .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 680, alignment: .leading)
            .padding(.top, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
    }
}

/// "← Planning tools": the way back to the client home, at the top of a tool.
struct PlanningCrumb: View {
    @EnvironmentObject var state: AppState
    var body: some View {
        Button { state.clientTool = nil } label: {
            HStack(spacing: 6) { Text("←"); Text("Planning tools") }
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.wealthAccentText)
        }
        .buttonStyle(.plain)
    }
}

/// Small uppercase label above an answer.
struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.system(size: 12, weight: .semibold)).tracking(0.9).foregroundStyle(.secondary)
    }
}

// MARK: - Shared pieces

struct ToolLayout<Inputs: View, Results: View>: View {
    let question: String
    /// Show the question as a small eyebrow, for tools whose answer is the headline.
    var eyebrow = false
    @ViewBuilder let inputs: Inputs
    @ViewBuilder let results: Results

    private var resultsColumn: some View {
        VStack(alignment: .leading, spacing: 18) {
            if eyebrow {
                Eyebrow(text: question)
            } else {
                Text(question).font(.system(size: 26, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            results
            ClientFootnote()
        }
    }

    private var inputColumn: some View {
        VStack(alignment: .leading, spacing: 16) {
            PlanningCrumb()
            inputs
        }
    }

    var body: some View {
        GeometryReader { geo in
            if geo.size.width < 780 {
                // Small window: inputs on top, results underneath, one scrolling column.
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        inputColumn
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Rectangle().fill(Color.wealthRule).frame(height: 1)
                        resultsColumn.padding(16)
                    }
                }
            } else {
                HStack(alignment: .top, spacing: 0) {
                    ScrollView {
                        inputColumn
                            .padding(24)
                    }
                    .frame(width: 360)
                    Rectangle().fill(Color.wealthRule).frame(width: 1)
                    ScrollView {
                        resultsColumn
                            .padding(.horizontal, 36).padding(.vertical, 28)
                            .frame(maxWidth: 900, alignment: .leading)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }
}

struct InputGroup<Content: View>: View {
    let title: String
    var note: String? = nil
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.subheadline.weight(.semibold))
            if let note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            content
        }
    }
}

/// A labelled number box with a slider. Typing and sliding edit the same value.
struct ClientInputRow: View {
    @EnvironmentObject var state: AppState
    let key: String
    let calc: Calculator?
    let field: ClientField

    private var unit: String { calc?.fields.first { $0.id == field.id }?.unit ?? "x" }

    private var text: Binding<String> {
        Binding(get: { state.clientRaw(key, field.id) }, set: { state.setClient(key, field.id, $0) })
    }

    private var slider: Binding<Double> {
        Binding(get: {
            let raw = state.clientRaw(key, field.id).isEmpty ? (field.blank ?? "") : state.clientRaw(key, field.id)
            let v = (try? Engine.parseNumber(raw, percent: false)) ?? field.range.lowerBound
            return min(max(v, field.range.lowerBound), field.range.upperBound)
        }, set: { v in
            let stepped = (v / field.step).rounded() * field.step
            state.setClient(key, field.id, Format.plain(stepped, maxDecimals: field.step < 1 ? 2 : 0))
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(field.label).font(.callout).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                HStack(spacing: 3) {
                    if unit == "$" { Text("$").foregroundStyle(.secondary) }
                    TextField(field.blank ?? "", text: text)
                        .textFieldStyle(.roundedBorder)
                        .multilineTextAlignment(.trailing)
                        .frame(width: unit == "$" ? 112 : 64)
                    if unit == "%" { Text("%").foregroundStyle(.secondary) }
                }
            }
            Slider(value: slider, in: field.range)
                .controlSize(.small)
        }
    }
}

struct ClientInputs: View {
    @EnvironmentObject var state: AppState
    let key: String
    let calcID: String
    let fields: [ClientField]
    var body: some View {
        ForEach(fields, id: \.id) { f in
            ClientInputRow(key: key, calc: state.calculator(calcID), field: f)
        }
    }
}

struct Headline: View {
    let text: String
    var caption: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(text).font(.system(size: 21, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
            if let caption { Text(caption).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Divider() }
    }
}

struct StatTile: View {
    let label: String
    let value: String
    var caption: String? = nil
    var negative = false
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.callout).foregroundStyle(.secondary).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            Text(value).font(.wealthSerif(24)).monospacedDigit()
                .foregroundStyle(negative ? Color.red : Color.primary).lineLimit(1).minimumScaleFactor(0.6)
            if let caption { Text(caption).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .overlay(alignment: .top) { Divider() }
    }
}

struct StatGrid<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 12)], spacing: 12) { content }
    }
}

struct ChartCard<Content: View>: View {
    let title: String
    var note: String? = nil
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            content
            if let note { Text(note).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.wealthCard, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.primary.opacity(0.08)))
    }
}

/// Shown until a tool has what it needs: says exactly which boxes are still empty.
struct NeedsInput: View {
    let calc: ClientCalc?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let calc, !calc.problems.isEmpty {
                ForEach(calc.problems, id: \.self) { Label($0, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
            }
            if let calc, !calc.missing.isEmpty {
                Text("To see the picture, fill in:").font(.headline)
                ForEach(calc.missing, id: \.self) { Label($0, systemImage: "circle").foregroundStyle(.secondary) }
            } else if calc == nil {
                Text("This tool is unavailable.").foregroundStyle(.secondary)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 14))
    }
}

/// Expandable plain statement of the method, with a jump to the full calculator.
struct HowItWorks: View {
    @EnvironmentObject var state: AppState
    let calcs: [ClientCalc]
    @State private var open = false
    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(calcs, id: \.calc.id) { c in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(c.calc.name).font(.subheadline.weight(.semibold))
                        Text(c.calc.math).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).textSelection(.enabled)
                        FormulaBreakdown(calc: c.calc, compact: true)
                        Text(c.calc.assumptions).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        Text(c.calc.interpretation).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        Button("Open the full calculator in Advisor Mode") { state.openInAdvisor(c) }.buttonStyle(.plain).foregroundStyle(Color.wealthAccent).font(.caption)
                    }
                }
            }
            .padding(.top, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Text("How this is calculated, and what it assumes").font(.callout.weight(.medium))
        }
        .padding(14)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
    }
}

private func moneyAxis() -> some AxisContent {
    AxisMarks { v in
        AxisGridLine()
        AxisValueLabel { if let d = v.as(Double.self) { Text(Money.compact(d)) } }
    }
}

// MARK: - 1. Growth

/// The month-by-month rule of the audited growth_schedule calculator: each month the balance grows
/// by one twelfth of the annual return, then the deposit is added, then the withdrawal is taken out,
/// never below zero. Used only to draw the chart and find the month the money runs out; the totals
/// shown come from the calculator, and the chart is shown only when this agrees with them.
/// Mirrors growthMonths() in web/app.js.
struct GrowthMonths {
    let bal: [Double]
    let end: Double
    let withdrawn: Double
    let months: Int
    /// First month the balance reaches $0 while a planned withdrawal could not be paid in full.
    let runOut: Int?

    init(p: Double, m: Double, r: Double, years: Int, wd: Double) {
        let i = r / 12, n = max(years, 0) * 12
        var b = p, out = 0.0, shortfall = false, firstZero: Int? = nil, list = [p]
        if n > 0 {
            for k in 1...n {
                let avail = max(0, b * (1 + i) + m)
                let take = min(wd, avail)
                if take < wd { shortfall = true }
                out += take; b = avail - take
                if wd > 0, b <= 0.005, firstZero == nil { firstZero = k }
                list.append(b)
            }
        }
        bal = list; end = b; withdrawn = out; months = n; runOut = shortfall ? firstZero : nil
    }
}

enum Usd {
    /// Whole dollars with thousands separators: "$3,400".
    static func whole(_ v: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal; f.locale = Locale(identifier: "en_US"); f.maximumFractionDigits = 0
        return (v < 0 ? "−" : "") + "$" + (f.string(from: NSNumber(value: abs(v).rounded())) ?? "0")
    }
    /// Keeps thousands separators while typing: "12500.5" → "12,500.5".
    static func typing(_ s: String) -> String {
        let clean = s.filter { $0.isNumber || $0 == "." }
        let parts = clean.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        var intPart = String(parts.first ?? "")
        while intPart.count > 1, intPart.hasPrefix("0") { intPart.removeFirst() }
        let dec = parts.count > 1 ? "." + String(parts[1].filter { $0 != "." }.prefix(2)) : ""
        // Group the typed digits directly (never through a Double, which would change long numbers).
        var grouped = ""
        for (n, ch) in intPart.reversed().enumerated() {
            if n > 0 && n % 3 == 0 { grouped.append(",") }
            grouped.append(ch)
        }
        grouped = String(grouped.reversed())
        if grouped.isEmpty && !dec.isEmpty { grouped = "0" }
        return grouped + dec
    }
}

/// A $-amount box that keeps thousands separators while typing.
struct MoneyBox: View {
    @EnvironmentObject var state: AppState
    let key: String
    let id: String
    let label: String
    var suffix: String? = nil
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary)
            HStack(spacing: 6) {
                Text("$").font(.system(size: 17)).foregroundStyle(.secondary)
                TextField("0", text: Binding(get: { state.clientRaw(key, id) },
                                             set: { state.setClient(key, id, Usd.typing($0)) }))
                    .textFieldStyle(.plain)
                    .font(.system(size: 19, weight: .semibold)).monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .focused($focused)
                    .accessibilityLabel(label)
                if let suffix { Text(suffix).font(.system(size: 14)).foregroundStyle(.secondary).fixedSize() }
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .background(Color.wealthCard, in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(focused ? Color.wealthAccent : Color.wealthRuleStrong, lineWidth: 1))
        }
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
    }
}

/// A slider with its value shown (and editable) beside the label.
struct SliderBox: View {
    @EnvironmentObject var state: AppState
    let key: String
    let field: ClientField
    let unit: String

    private func scale(_ v: Double) -> String { Format.plain(v, maxDecimals: 2) + (unit == "%" ? "%" : "") }

    var body: some View {
        let r = field.range
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(field.label).font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                TextField("—", text: Binding(get: { state.clientRaw(key, field.id) }, set: { state.setClient(key, field.id, $0) }))
                    .textFieldStyle(.plain).multilineTextAlignment(.trailing)
                    .font(.system(size: 17, weight: .semibold)).monospacedDigit()
                    .frame(width: 60)
                    .overlay(alignment: .bottom) { Rectangle().fill(Color.wealthRuleStrong).frame(height: 1).offset(y: 2) }
                    .accessibilityLabel(field.label)
                Text(unit).font(.system(size: 14)).foregroundStyle(.secondary)
            }
            Slider(value: Binding(get: {
                let v = (try? Engine.parseNumber(state.clientRaw(key, field.id), percent: false)) ?? r.lowerBound
                return min(max(v, r.lowerBound), r.upperBound)
            }, set: { v in
                state.setClient(key, field.id, Format.plain((v / field.step).rounded() * field.step, maxDecimals: field.step < 1 ? 2 : 0))
            }), in: r)
            .controlSize(.small)
            .accessibilityLabel(field.label)
            HStack {
                Text(scale(r.lowerBound)); Spacer(); Text(scale(r.upperBound))
            }
            .font(.system(size: 12)).monospacedDigit().foregroundStyle(.tertiary)
        }
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
    }
}

/// "How much could I save?": compact inputs, one plain-sentence answer and a monthly balance chart.
/// Mirrors growthTool() in web/app.js.
struct GrowthTool: View {
    @EnvironmentObject var state: AppState
    @State private var wdOpen: Bool?
    static let key = "client.growth"

    private static let yearWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
    static func yearsWord(_ n: Int) -> String {
        (n >= 0 && n <= 10 ? yearWords[n] : String(n)) + (n == 1 ? " year" : " years")
    }

    private func field(_ id: String) -> ClientField { ClientSpec.growth.first { $0.id == id }! }

    var body: some View {
        let key = Self.key
        let c = state.clientRun(key, "growth_schedule", ClientSpec.growth)
        let hasWd = !state.clientRaw(key, "wd").trimmingCharacters(in: .whitespaces).isEmpty
        let showWd = wdOpen ?? hasWd
        ToolLayout(question: ClientSpec.title(.growth), eyebrow: true) {
            VStack(alignment: .leading, spacing: 0) {
                Rectangle().fill(Color.wealthInk).frame(height: 1)
                MoneyBox(key: key, id: "p", label: "Starting amount")
                MoneyBox(key: key, id: "m", label: "Added each month", suffix: "/ mo")
                SliderBox(key: key, field: field("r"), unit: "%")
                SliderBox(key: key, field: field("y"), unit: "yrs")
                if showWd {
                    MoneyBox(key: key, id: "wd", label: "Taken out each month", suffix: "/ mo")
                    Button("Remove withdrawal") { wdOpen = false; state.setClient(key, "wd", "") }
                        .buttonStyle(.plain).font(.system(size: 13)).foregroundStyle(.secondary).padding(.top, 8)
                } else {
                    Button("+ Add a withdrawal") { wdOpen = true }
                        .buttonStyle(.plain).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.wealthAccentText)
                        .padding(.vertical, 14)
                }
            }
            MoreAssumptions(key: key, ids: ["infl"], note: "Inflation shows what the ending balance would buy in today's dollars.") {
                ClientInputs(key: key, calcID: "growth_schedule", fields: [field("infl")])
            }
        } results: {
            if let c, c.ok, c.eval.table != nil {
                answer(c)
            } else {
                Text("Type in your numbers to see the answer.").font(.wealthAnswer(40)).foregroundStyle(Color.wealthInk)
                    .fixedSize(horizontal: false, vertical: true)
                NeedsInput(calc: c)
                Button("Use an example: $1,000, $100 a month, 0%, two years") {
                    for (k, v) in ["p": "1,000", "m": "100", "r": "0", "y": "2"] { state.setClient(key, k, v) }
                }
            }
        }
    }

    @ViewBuilder private func answer(_ c: ClientCalc) -> some View {
        let num = { (id: String, pct: Bool) -> Double in (try? Engine.parseNumber(c.inputs[id] ?? "", percent: pct)) ?? 0 }
        let p = num("p", false), m = num("m", false), r = num("r", true), years = Int(num("y", false)), wd = num("wd", false)
        let sim = GrowthMonths(p: p, m: m, r: r, years: years, wd: wd)
        // The chart must agree with the audited calculator; if it ever doesn't, say so rather than show it.
        let agrees = abs(sim.end - c.v(0)) < 0.01 && abs(sim.withdrawn - c.v(4)) < 0.01
        let span = Self.yearsWord(years)
        let hasInfl = !state.clientRaw(Self.key, "infl").trimmingCharacters(in: .whitespaces).isEmpty
        let runOutMonth = agrees ? sim.runOut : nil
        let runsOut = wd > 0 && (runOutMonth != nil || (!agrees && c.v(5) >= 0))
        let head: String = {
            if runsOut {
                if let k = runOutMonth { return sim.months <= 36 ? "Your savings run out in month \(k)." : "Your savings run out in year \((k + 11) / 12)." }
                return "Your savings run out in year \(Int(c.v(5)))."
            }
            if wd > 0 { return "After \(span) you’d have \(Usd.whole(c.v(0)))." }
            return "In \(span) you could have \(Usd.whole(c.v(0)))."
        }()
        let bold = { (s: String) in Text(s).fontWeight(.semibold).foregroundColor(Color.wealthInk) }
        let sub: Text = {
            if runsOut {
                return Text("You could withdraw ") + bold(Usd.whole(c.v(4))) + Text(" of the ") + bold(Usd.whole(wd * Double(years * 12))) + Text(" planned over \(span).")
            }
            if wd > 0 { return Text("That’s after withdrawing the full ") + bold(Usd.whole(c.v(4))) + Text(" you planned.") }
            return Text("Starting with ") + bold(Usd.whole(p)) + Text(" and adding ") + bold(Usd.whole(m)) + Text(" a month at a ")
                + bold(Format.plain(r * 100, maxDecimals: 2) + "%") + Text(" annual return.")
        }()
        VStack(alignment: .leading, spacing: 6) {
            Text(head).font(.wealthAnswer(40)).foregroundStyle(Color.wealthInk).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            sub.font(.system(size: 18)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).frame(maxWidth: 560, alignment: .leading)
        }
        if agrees {
            GrowthChart(sim: sim, runOut: runOutMonth)
        } else {
            Text("The month-by-month chart is unavailable for these inputs.").font(.callout).foregroundStyle(.secondary)
        }
        GrowthBreakdown(c: c, p: p, hasInfl: hasInfl)
    }
}

/// "Breakdown and method", folded away under the chart.
struct GrowthBreakdown: View {
    let c: ClientCalc
    let p: Double
    let hasInfl: Bool
    @State private var open = false

    var body: some View {
        var items: [(String, Double)] = [("Starting amount", p), ("Total put in", c.v(1)), ("Growth", c.v(2)), ("Total withdrawn", c.v(4))]
        if hasInfl { items.append(("Ending balance in today's dollars", c.v(3))) }
        return DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                        HStack(spacing: 0) {
                            if i > 0 { Rectangle().fill(Color.wealthRule).frame(width: 1).padding(.trailing, 16) }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.0).font(.system(size: 13)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                                Text(Usd.whole(item.1)).font(.system(size: 18, weight: .semibold)).monospacedDigit()
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.trailing, 16)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                Text("“Total put in” includes the starting amount. Month by month: the balance grows at one twelfth of the annual return, then the monthly deposit is added, then the withdrawal is taken out. A withdrawal never takes more than the account holds. No taxes or fees are included. The return is an assumption you choose, not a forecast.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                HowItWorks(calcs: [c])
            }
            .padding(.top, 8)
        } label: {
            Text("Breakdown and method").font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary)
        }
        .padding(.top, 10)
        .overlay(alignment: .top) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
    }
}

/// The monthly balance, with the point where it reaches $0 marked (or the ending balance labelled).
struct GrowthChart: View {
    let sim: GrowthMonths
    let runOut: Int?
    struct Pt: Identifiable { let id: Int; let x: Double; let b: Double }

    /// Axis labels that never round two ticks to the same text: whole dollars below $10k, then k / M / B / T.
    static func tick(_ d: Double, _ maxB: Double) -> String {
        if d == 0 { return "$0" }
        if maxB < 10_000 { return Usd.whole(d) }
        if maxB < 1_000_000 { return "$" + Format.plain(d / 1e3, maxDecimals: 1) + "k" }
        if maxB < 1e9 { return "$" + Format.plain(d / 1e6, maxDecimals: 2) + "M" }
        if maxB < 1e12 { return "$" + Format.plain(d / 1e9, maxDecimals: 2) + "B" }
        return "$" + Format.plain(d / 1e12, maxDecimals: 2) + "T"
    }

    var body: some View {
        let inYears = sim.months > 36, per = inYears ? 12.0 : 1.0
        let pts = sim.bal.enumerated().map { Pt(id: $0.offset, x: Double($0.offset) / per, b: $0.element) }
        let maxB = max(sim.bal.max() ?? 1, 1)
        let endX = Double(sim.months) / per
        Chart {
            ForEach(pts) { p in
                AreaMark(x: .value(inYears ? "Year" : "Month", p.x), y: .value("Balance", p.b))
                    .foregroundStyle(Color.wealthAccent.opacity(0.12))
                LineMark(x: .value(inYears ? "Year" : "Month", p.x), y: .value("Balance", p.b))
                    .foregroundStyle(Color.wealthAccent).lineStyle(StrokeStyle(lineWidth: 2.25, lineJoin: .round))
            }
            PointMark(x: .value("Start", 0.0), y: .value("Balance", sim.bal[0]))
                .foregroundStyle(Color.wealthAccent).symbolSize(40)
            if let k = runOut {
                let x = Double(k) / per
                let label = inYears ? "Reaches $0 in year \((k + 11) / 12)" : "Reaches $0 in month \(k)"
                RuleMark(x: .value("Reaches $0", x))
                    .foregroundStyle(Color.wealthInk.opacity(0.8)).lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
                    .annotation(position: .top, alignment: x > endX * 0.68 ? .trailing : .leading, spacing: 4) {
                        Text(label).font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.wealthInk)
                    }
                PointMark(x: .value("Reaches $0", x), y: .value("Balance", 0.0))
                    .symbol { Circle().strokeBorder(Color.wealthInk, lineWidth: 2).background(Circle().fill(Color.wealthPaper)).frame(width: 11, height: 11) }
            } else {
                PointMark(x: .value("End", endX), y: .value("Balance", sim.end))
                    .foregroundStyle(Color.wealthAccent).symbolSize(70)
                    .annotation(position: .top, alignment: .trailing, spacing: 6) {
                        Text(Usd.whole(sim.end)).font(.system(size: 14, weight: .semibold)).monospacedDigit().foregroundStyle(Color.wealthInk)
                    }
            }
        }
        .chartXScale(domain: 0...max(endX, 1))
        .chartYScale(domain: 0...(maxB * 1.12))
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { v in
                AxisGridLine().foregroundStyle(Color.wealthRule)
                AxisValueLabel { if let d = v.as(Double.self) { Text(Self.tick(d, maxB)).font(.system(size: 13)).monospacedDigit() } }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 8)) { v in
                AxisTick().foregroundStyle(Color.wealthRuleStrong)
                AxisValueLabel { if let d = v.as(Double.self) { Text(Format.plain(d, maxDecimals: 0)).font(.system(size: 13)).monospacedDigit() } }
            }
        }
        .chartXAxisLabel(inYears ? "Years" : "Months", alignment: .trailing)
        .frame(height: 280)
        .padding(.top, 14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Balance by \(inYears ? "year" : "month"), from \(Usd.whole(sim.bal[0])) to \(Usd.whole(sim.end))")
    }
}

// MARK: - 2. Retirement

struct RetirementTool: View {
    @EnvironmentObject var state: AppState
    struct Band: Identifiable { let id = UUID(); let age: Double; let lo: Double; let mid: Double; let hi: Double }

    var body: some View {
        let t = state.clientRun("client.retirement", "retirement_timeline", ClientSpec.retirement)
        let hasVol = !state.clientRaw("client.retirement", "sd").trimmingCharacters(in: .whitespaces).isEmpty
        let mc = hasVol ? state.clientRun("client.retirement", "retirement_mc", ClientSpec.retirement) : nil
        ToolLayout(question: ClientSpec.title(.retirement)) {
            InputGroup(title: "About you") {
                ClientInputs(key: "client.retirement", calcID: "retirement_mc", fields: ClientSpec.retirementYou)
            }
            InputGroup(title: "Assumptions", note: "A return is an assumption, not a promise.") {
                ClientInputs(key: "client.retirement", calcID: "retirement_mc", fields: Array(ClientSpec.retirementAssumptions.prefix(3)))
            }
            MoreAssumptions(key: "client.retirement", ids: ClientSpec.retirementAssumptions.dropFirst(3).map(\.id),
                            note: "Optional. Leave volatility empty for a single steady path, or enter it to see a range of outcomes. Enter a tax rate to include tax on withdrawals.") {
                ClientInputs(key: "client.retirement", calcID: "retirement_mc", fields: Array(ClientSpec.retirementAssumptions.dropFirst(3)))
            }
        } results: {
            if let t, t.ok, let table = t.eval.table {
                let plan = (table.rows.last?[0] ?? 0) + 1
                let lasts = t.v(3) < 0
                let rate = t.v(0) > 0 ? t.v(1) / t.v(0) : .nan
                let taxed = t.v(5) > 0
                let taken = t.v(4) > 0 ? "\(Format.currency(t.v(4))) is taken out over the retirement years\(taxed ? ", \(Format.currency(t.v(5))) of it for taxes" : "")." : ""
                Headline(text: lasts ? "On this steady path the money lasts through age \(Int(plan))."
                                     : "On this steady path the money runs out around age \(Int(t.v(3))).",
                         caption: (lasts ? "About \(Format.currency(t.v(2))) would remain at the end of the plan. "
                                         : "That is \(Int(plan - t.v(3))) years before the end of the plan. ") + taken)
                StatGrid {
                    StatTile(label: "Savings at retirement", value: Format.currency(t.v(0)))
                    StatTile(label: "First-year withdrawal", value: Format.currency(t.v(1)),
                             caption: rate.isNaN ? nil : "\(Format.percent(rate)) of savings at retirement\(taxed ? ", including tax" : "")")
                    StatTile(label: "Total taken out in retirement", value: Format.currency(t.v(4)),
                             caption: taxed ? "Including \(Format.currency(t.v(5))) in taxes" : "Spending not covered by other income")
                    StatTile(label: lasts ? "Left at end of plan" : "Money runs out at age", value: lasts ? Format.currency(t.v(2)) : "\(Int(t.v(3)))", negative: !lasts)
                    if let mc, mc.ok {
                        StatTile(label: "Simulated paths where the money lasts", value: Format.percent(mc.v(0)),
                                 caption: "Out of \(mc.inputs["sims"] ?? "") random market paths")
                    }
                }
                ChartCard(title: "Savings over time",
                          note: mc?.ok == true ? "Shaded band: the middle 80% of simulated outcomes. Solid line: the steady path. Markets don't deliver the same return every year, so the band is the more realistic picture."
                                               : "A single steady path with the same return every year. Enter a volatility assumption to see a range.") {
                    let bands: [Band] = (mc?.ok == true ? mc?.eval.table?.rows : nil)?.map { Band(age: $0[0], lo: $0[1], mid: $0[2], hi: $0[3]) } ?? []
                    Chart {
                        ForEach(bands) { b in
                            AreaMark(x: .value("Age", b.age), yStart: .value("Low", b.lo), yEnd: .value("High", b.hi))
                                .foregroundStyle(Color.wealthAccent.opacity(0.18))
                        }
                        ForEach(table.rows, id: \.self) { r in
                            LineMark(x: .value("Age", r[0] + 1), y: .value("Savings", r[5]))
                                .foregroundStyle(Color.wealthAccent)
                                .lineStyle(StrokeStyle(lineWidth: 2.5))
                        }
                        if let retire = Double(t.inputs["retire"] ?? "") {
                            RuleMark(x: .value("Retirement", retire))
                                .foregroundStyle(Color.secondary)
                                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                                .annotation(position: .top, alignment: .leading) { Text("Retire").font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                    .chartYAxis { moneyAxis() }
                    .chartXAxisLabel("Age")
                    .chartXScale(domain: .automatic(includesZero: false))
                    .frame(height: 280)
                }
                WithdrawalBars(rows: table.rows.filter { $0[3] > 0 }, taxed: taxed)
                if let mc, !mc.ok, hasVol { NeedsInput(calc: mc) }
                HowItWorks(calcs: [t] + (mc?.ok == true ? [mc!] : []))
            } else {
                NeedsInput(calc: t)
            }
        }
    }
}

/// Each retirement year's withdrawal, split into spending and the tax on it.
struct WithdrawalBars: View {
    let rows: [[Double]]
    let taxed: Bool
    struct Part: Identifiable { let id = UUID(); let age: Double; let part: String; let value: Double }

    var body: some View {
        if !rows.isEmpty {
            ChartCard(title: "Taken out each year",
                      note: taxed ? "Each bar is the year's withdrawal: what is spent, plus the income tax on it at the rate entered. Amounts grow with inflation; other income such as Social Security reduces them once it starts."
                                  : "Each bar is the year's withdrawal: spending not covered by other income. Amounts grow with inflation and drop when other income such as Social Security starts. Taxes on withdrawals aren't included; enter a tax rate to add them.") {
                let parts = rows.flatMap { r in [Part(age: r[0], part: "Spending", value: r[3] - r[6])] + (taxed ? [Part(age: r[0], part: "Tax on withdrawals", value: r[6])] : []) }
                Chart(parts) { p in
                    BarMark(x: .value("Age", p.age), y: .value("Withdrawal", p.value), width: .fixed(rows.count > 30 ? 6 : 10))
                        .foregroundStyle(by: .value("Part", p.part))
                }
                .chartForegroundStyleScale(["Spending": Color.wealthAccent, "Tax on withdrawals": Color.orange])
                .chartLegend(taxed ? .visible : .hidden)
                .chartYAxis { moneyAxis() }
                .chartXAxisLabel("Age")
                .chartXScale(domain: .automatic(includesZero: false))
                .frame(height: 220)
            }
        }
    }
}

// MARK: - 3. Risk

struct RiskTool: View {
    @EnvironmentObject var state: AppState
    @State private var compare = false
    struct Bar: Identifiable { let id = UUID(); let column: String; let part: String; let value: Double }

    static func mixB(_ state: AppState) -> ClientCalc? {
        var over: [String: String] = [:]
        for id in ["we", "wb"] where !state.clientRaw("client.risk.B", id).isEmpty { over[id] = state.clientRaw("client.risk.B", id) }
        return state.clientRun("client.risk", "portfolio_stress", ClientSpec.risk, overrides: over)
    }

    static func volatility(_ state: AppState) -> ClientCalc? {
        var over: [String: String] = [:]
        for id in ["v", "we", "wb"] { over[id] = state.clientRaw("client.risk", id) }
        for id in ["sa", "sb", "rho"] { over[id] = state.clientRaw("client.risk.vol", id) }
        return state.clientRun("client.risk.none", "mix_volatility", ClientSpec.risk + ClientSpec.volatility, overrides: over)
    }

    private func bars(_ c: ClientCalc, _ name: String) -> [Bar] {
        func num(_ id: String) -> Double? {
            guard let f = c.calc.fields.first(where: { $0.id == id }), case .number(let x)? = try? Engine.parse(c.inputs[id] ?? "", field: f) else { return nil }
            return x
        }
        guard let v = num("v"), let we = num("we"), let wb = num("wb") else { return [] }
        let s = v * we, b = v * wb, cash = v - s - b
        return [Bar(column: "\(name) today", part: "Stocks", value: s), Bar(column: "\(name) today", part: "Bonds", value: b),
                Bar(column: "\(name) today", part: "Cash", value: cash),
                Bar(column: "\(name) after", part: "Stocks", value: s + c.v(0)), Bar(column: "\(name) after", part: "Bonds", value: b + c.v(1)),
                Bar(column: "\(name) after", part: "Cash", value: cash)]
    }

    var body: some View {
        let a = state.clientRun("client.risk", "portfolio_stress", ClientSpec.risk)
        let b = compare ? RiskTool.mixB(state) : nil
        let vol = RiskTool.volatility(state)
        ToolLayout(question: ClientSpec.title(.risk)) {
            InputGroup(title: "Portfolio", note: "Whatever isn't in stocks or bonds is treated as cash.") {
                ClientInputs(key: "client.risk", calcID: "portfolio_stress", fields: Array(ClientSpec.risk.prefix(3)))
            }
            InputGroup(title: "What if…", note: "You choose the scenario. This shows what would happen if it occurred, not how likely it is.") {
                ClientInputs(key: "client.risk", calcID: "portfolio_stress", fields: Array(ClientSpec.risk.dropFirst(3).prefix(2)))
            }
            MoreAssumptions(key: "client.risk", ids: ClientSpec.risk.dropFirst(5).map(\.id), note: "Optional: how sensitive the bonds are to rates, inflation over the period, and any money taken out.") {
                ClientInputs(key: "client.risk", calcID: "portfolio_stress", fields: Array(ClientSpec.risk.dropFirst(5)))
            }
            InputGroup(title: "Compare another mix") {
                Toggle("Show a second mix side by side", isOn: $compare)
                if compare {
                    ClientInputs(key: "client.risk.B", calcID: "portfolio_stress", fields: [
                        .init(id: "we", label: "Stocks (mix B)", range: 0...100, step: 5),
                        .init(id: "wb", label: "Bonds (mix B)", range: 0...100, step: 5)])
                }
            }
            InputGroup(title: "Typical ups and downs (optional)", note: "Enter volatility assumptions to see how much the mix usually moves in a year.") {
                ClientInputs(key: "client.risk.vol", calcID: "mix_volatility", fields: ClientSpec.volatility)
            }
        } results: {
            if let a, a.ok {
                let down = a.v(2) < 0
                Headline(text: "In this scenario the portfolio would be about \(Format.currency(abs(a.v(2)))) \(down ? "lower" : "higher") (\(Format.percent(a.v(3)))).",
                         caption: "A what-if based on the changes entered. It is not a forecast and says nothing about how likely this is.")
                StatGrid {
                    StatTile(label: "Change in value", value: Format.currency(a.v(2)), negative: down)
                    StatTile(label: "Change in percent", value: Format.percent(a.v(3)), negative: down)
                    StatTile(label: "Value afterwards", value: Format.currency(a.v(4)), caption: "After any withdrawal entered")
                    StatTile(label: "From stocks / from bonds", value: "\(Money.compact(a.v(0))) / \(Money.compact(a.v(1)))")
                }
                if let b, b.ok {
                    ChartCard(title: "Mix A compared with mix B", note: "Same scenario, two different mixes.") {
                        StatGrid {
                            StatTile(label: "Mix A change", value: Format.currency(a.v(2)), caption: Format.percent(a.v(3)), negative: a.v(2) < 0)
                            StatTile(label: "Mix B change", value: Format.currency(b.v(2)), caption: Format.percent(b.v(3)), negative: b.v(2) < 0)
                            StatTile(label: "Difference (B − A)", value: Format.currency(b.v(2) - a.v(2)))
                        }
                    }
                } else if compare, let b { NeedsInput(calc: b) }
                ChartCard(title: "Before and after", note: "Bond values are estimated from duration: a 1% rise in rates lowers bond prices by roughly the duration in percent.") {
                    let data = bars(a, "Mix A") + (b?.ok == true ? bars(b!, "Mix B") : [])
                    Chart(data) { d in
                        BarMark(x: .value("When", d.column), y: .value("Value", d.value))
                            .foregroundStyle(by: .value("Holding", d.part))
                    }
                    .chartForegroundStyleScale(["Stocks": Color.wealthAccent, "Bonds": Color.blue.opacity(0.7), "Cash": Color.gray.opacity(0.5)])
                    .chartYAxis { moneyAxis() }
                    .frame(height: 260)
                }
                if let vol, vol.ok {
                    ChartCard(title: "Typical ups and downs", note: "Volatility is a yardstick for normal fluctuation, not a worst case and not a prediction.") {
                        StatGrid {
                            StatTile(label: "Volatility of this mix", value: Format.percent(vol.v(0)), caption: "Standard deviation of yearly returns, from your assumptions")
                            StatTile(label: "A typical one-year swing", value: "± " + Format.currency(vol.v(1)))
                            StatTile(label: "Share of the risk from stocks", value: Format.percent(vol.v(2)))
                        }
                    }
                }
                HStack {
                    Button("See current market conditions (RoRo, Advisor Mode)") { state.enter(.advisor); state.selection = .roro }
                        .buttonStyle(.plain).foregroundStyle(Color.wealthAccent)
                    Spacer()
                }
                HowItWorks(calcs: [a] + (vol?.ok == true ? [vol!] : []))
            } else {
                NeedsInput(calc: a)
            }
        }
    }
}

// MARK: - 4. Decisions

struct DecisionsTool: View {
    @EnvironmentObject var state: AppState
    struct Pt: Identifiable { let id = UUID(); let age: Double; let value: Double; let option: String }

    static func optionB(_ state: AppState) -> ClientCalc? {
        var over: [String: String] = [:]
        for f in ClientSpec.decisionLevers where !state.clientRaw("client.decisions.B", f.id).trimmingCharacters(in: .whitespaces).isEmpty {
            over[f.id] = state.clientRaw("client.decisions.B", f.id)
        }
        return state.clientRun("client.retirement", "retirement_timeline", ClientSpec.retirement, overrides: over)
    }

    private func lasts(_ c: ClientCalc) -> String {
        c.v(3) < 0 ? "Lasts through the plan" : "Runs out at age \(Int(c.v(3)))"
    }

    var body: some View {
        let a = state.clientRun("client.retirement", "retirement_timeline", ClientSpec.retirement)
        let b = DecisionsTool.optionB(state)
        let changed = ClientSpec.decisionLevers.contains { !state.clientRaw("client.decisions.B", $0.id).trimmingCharacters(in: .whitespaces).isEmpty }
        ToolLayout(question: ClientSpec.title(.decisions)) {
            InputGroup(title: "Option A: the starting plan", note: "Shared with “Am I on track for retirement?”.") {
                ClientInputs(key: "client.retirement", calcID: "retirement_mc", fields: ClientSpec.retirementYou)
                ClientInputs(key: "client.retirement", calcID: "retirement_mc", fields: Array(ClientSpec.retirementAssumptions.prefix(3)))
            }
            InputGroup(title: "Option B: change one or more things", note: "Leave a box empty to keep it the same as option A.") {
                ClientInputs(key: "client.decisions.B", calcID: "retirement_mc", fields: ClientSpec.decisionLevers)
            }
        } results: {
            if let a, a.ok, let b, b.ok, let ta = a.eval.table, let tb = b.eval.table {
                if changed {
                    let diff = b.v(2) - a.v(2)
                    Headline(text: "Option B ends the plan with \(Format.currency(abs(diff))) \(diff >= 0 ? "more" : "less") than option A.",
                             caption: "A: \(lasts(a)). B: \(lasts(b)).")
                } else {
                    Headline(text: "Change something under Option B to compare.", caption: "For example: retire five years earlier, save more each year, or spend less in retirement.")
                }
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 10) {
                    GridRow {
                        Text("").gridColumnAlignment(.leading)
                        Text("Option A").font(.headline).gridColumnAlignment(.trailing)
                        Text("Option B").font(.headline).gridColumnAlignment(.trailing)
                        Text("Difference").font(.headline).gridColumnAlignment(.trailing)
                    }
                    Divider()
                    row("Savings at retirement", a.v(0), b.v(0))
                    row("First-year withdrawal", a.v(1), b.v(1))
                    row("Left at end of plan", a.v(2), b.v(2))
                    GridRow {
                        Text("How long the money lasts")
                        Text(lasts(a)).monospacedDigit()
                        Text(lasts(b)).monospacedDigit()
                        Text("")
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.wealthCard, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.primary.opacity(0.08)))
                ChartCard(title: "Savings over time", note: "Both lines use a steady return every year. Real markets vary; see the retirement tool for a range of outcomes.") {
                    let pts = ta.rows.map { Pt(age: $0[0] + 1, value: $0[5], option: "Option A") } + tb.rows.map { Pt(age: $0[0] + 1, value: $0[5], option: "Option B") }
                    Chart(pts) { p in
                        LineMark(x: .value("Age", p.age), y: .value("Savings", p.value))
                            .foregroundStyle(by: .value("Option", p.option))
                            .lineStyle(StrokeStyle(lineWidth: 2.5))
                    }
                    .chartForegroundStyleScale(["Option A": Color.gray, "Option B": Color.wealthAccent])
                    .chartYAxis { moneyAxis() }
                    .chartXAxisLabel("Age")
                    .chartXScale(domain: .automatic(includesZero: false))
                    .frame(height: 280)
                }
                HowItWorks(calcs: [a])
            } else {
                NeedsInput(calc: (a?.ok == true) ? b : a)
            }
        }
    }

    private func row(_ label: String, _ a: Double, _ b: Double) -> some View {
        GridRow {
            Text(label)
            Text(Format.currency(a)).monospacedDigit()
            Text(Format.currency(b)).monospacedDigit()
            Text((b - a >= 0 ? "+" : "") + Format.currency(b - a)).monospacedDigit().foregroundStyle(b - a < 0 ? Color.red : Color.wealthAccent)
        }
    }
}

// MARK: - 5. Taxes and inflation

struct TaxesTool: View {
    @EnvironmentObject var state: AppState
    @State private var tab = 0
    struct Pt: Identifiable { let id = UUID(); let year: Double; let value: Double }
    struct Bar: Identifiable { let id = UUID(); let name: String; let value: Double }

    var body: some View {
        let infl = state.clientRun("client.inflation", "inflation_cost", ClientSpec.inflation)
        let drag = state.clientRun("client.taxdrag", "tax_deferral", ClientSpec.taxDrag)
        let tax = state.clientRun("client.incometax", "income_tax", ClientSpec.incomeTax)
        ToolLayout(question: ClientSpec.title(.taxes)) {
            Picker("", selection: $tab) {
                Text("Inflation").tag(0)
                Text("Taxes on growth").tag(1)
                Text("Income tax").tag(2)
            }
            .pickerStyle(.segmented).labelsHidden()
            switch tab {
            case 0:
                InputGroup(title: "Inflation and buying power") {
                    ClientInputs(key: "client.inflation", calcID: "inflation_cost", fields: ClientSpec.inflation)
                }
            case 1:
                InputGroup(title: "Taxes on investment growth", note: "Compares paying tax on earnings every year with paying once at the end.") {
                    ClientInputs(key: "client.taxdrag", calcID: "tax_deferral", fields: ClientSpec.taxDrag)
                }
            default:
                InputGroup(title: "Income tax estimate", note: "Federal and state tax on ordinary taxable income. Local taxes, credits and other taxes aren't included.") {
                    ClientInputs(key: "client.incometax", calcID: "income_tax", fields: ClientSpec.incomeTax)
                    ForEach([("status", "Filing status"), ("st", "State you file in")], id: \.0) { id, label in
                        if let f = state.calculator("income_tax")?.fields.first(where: { $0.id == id }), let options = f.options {
                            Picker(label, selection: Binding(get: { state.clientRaw("client.incometax", id).isEmpty ? f.example : state.clientRaw("client.incometax", id) },
                                                             set: { state.setClient("client.incometax", id, $0) })) {
                                ForEach(options, id: \.value) { Text($0.label).tag(Format.plain($0.value)) }
                            }
                        }
                    }
                }
            }
        } results: {
            switch tab {
            case 0: inflation(infl)
            case 1: taxDrag(drag)
            default: incomeTax(tax)
            }
        }
    }

    @ViewBuilder private func inflation(_ c: ClientCalc?) -> some View {
        if let c, c.ok, let engine = state.engine, let n = Double(c.inputs["n"] ?? "") {
            Headline(text: "What costs \(ReportSection.display(c.inputs["c"] ?? "", field: c.calc.fields[0])) today would cost about \(Format.currency(c.v(0))) in \(Int(n)) years.",
                     caption: "Put another way, that same amount of money would then buy only what \(Format.currency(c.v(1))) buys today.")
            StatGrid {
                StatTile(label: "Future cost of the same thing", value: Format.currency(c.v(0)))
                StatTile(label: "Buying power of today's amount, later", value: Format.currency(c.v(1)), negative: true)
            }
            ChartCard(title: "Buying power over time", note: "Each point is the same calculation for that many years.") {
                let pts: [Pt] = (0...Int(n)).compactMap { k in
                    var i = c.inputs; i["n"] = String(k)
                    return engine.evaluate(c.calc, inputs: i).outputs.dropFirst().first?.value.map { Pt(year: Double(k), value: $0) }
                }
                Chart(pts) { p in
                    AreaMark(x: .value("Year", p.year), y: .value("Buying power", p.value)).foregroundStyle(Color.wealthAccent.opacity(0.2))
                    LineMark(x: .value("Year", p.year), y: .value("Buying power", p.value)).foregroundStyle(Color.wealthAccent)
                }
                .chartYAxis { moneyAxis() }
                .chartXAxisLabel("Years from now")
                .frame(height: 240)
            }
            HowItWorks(calcs: [c])
        } else { NeedsInput(calc: c) }
    }

    @ViewBuilder private func taxDrag(_ c: ClientCalc?) -> some View {
        if let c, c.ok {
            Headline(text: "Paying tax on earnings every year leaves \(Format.currency(c.v(0))). Deferring the tax to the end leaves \(Format.currency(c.v(1))).",
                     caption: "The difference, \(Format.currency(c.v(2))), comes from letting untaxed gains keep compounding.")
            ChartCard(title: "Ending value after tax") {
                Chart([Bar(name: "Taxed every year", value: c.v(0)), Bar(name: "Taxed once at the end", value: c.v(1))]) { b in
                    BarMark(x: .value("Account", b.name), y: .value("Value", b.value))
                        .foregroundStyle(b.name.hasPrefix("Taxed once") ? Color.wealthAccent : Color.gray.opacity(0.6))
                        .annotation(position: .top) { Text(Format.currency(b.value)).font(.caption).monospacedDigit() }
                }
                .chartYAxis { moneyAxis() }
                .frame(height: 240)
            }
            HowItWorks(calcs: [c])
        } else { NeedsInput(calc: c) }
    }

    @ViewBuilder private func incomeTax(_ c: ClientCalc?) -> some View {
        TaxYearBanner()
        if let c, c.ok, case .number(let income)? = try? Engine.parse(c.inputs["ti"] ?? "", field: c.calc.fields[0]),
           let st = try? state.engine?.tax.state(Double(c.inputs["st"] ?? "0") ?? 0) {
            let noTax = st.none == true || st.brackets == nil
            Headline(text: "Estimated income tax: \(Format.currency(c.v(7))), which is \(Format.percent(c.v(8))) of this income.",
                     caption: noTax ? "\(st.name) has no tax on wages, so this is all federal. The next dollar would be taxed at \(Format.percent(c.v(6)))."
                        : "\(Format.currency(c.v(0))) federal plus \(Format.currency(c.v(4))) \(st.name). The next dollar would be taxed at \(Format.percent(c.v(6))): \(Format.percent(c.v(1))) federal plus \(Format.percent(c.v(5))) state.")
            StatGrid {
                StatTile(label: "Federal income tax", value: Format.currency(c.v(0)))
                StatTile(label: "\(st.name) income tax", value: Format.currency(c.v(4)), caption: "Estimate; local taxes not included")
                StatTile(label: "Average rate, federal + state", value: Format.percent(c.v(8)))
                StatTile(label: "Rate on the next dollar, federal + state", value: Format.percent(c.v(6)),
                         caption: "\(Format.percent(c.v(1))) federal + \(Format.percent(c.v(5))) state")
            }
            ChartCard(title: "Where the income goes", note: st.notes.isEmpty ? nil : st.notes.joined(separator: " ")) {
                Chart([Bar(name: "Kept after income tax", value: income - c.v(7)), Bar(name: "Federal income tax", value: c.v(0)),
                       Bar(name: "State income tax", value: c.v(4))]) { b in
                    BarMark(x: .value("Dollars", b.value), y: .value("", "Income"))
                        .foregroundStyle(by: .value("Part", b.name))
                }
                .chartForegroundStyleScale(["Kept after income tax": Color.wealthAccent, "Federal income tax": Color.orange, "State income tax": Color.blue.opacity(0.75)])
                .chartXAxis { AxisMarks { v in AxisGridLine(); AxisValueLabel { if let d = v.as(Double.self) { Text(Money.compact(d)) } } } }
                .frame(height: 110)
            }
            HowItWorks(calcs: [c])
        } else if let c, c.ok, case .number(let income)? = try? Engine.parse(c.inputs["ti"] ?? "", field: c.calc.fields[0]) {
            Headline(text: "Estimated federal income tax: \(Format.currency(c.v(0))), which is \(Format.percent(c.v(2))) of this income.",
                     caption: "The next dollar earned would be taxed at \(Format.percent(c.v(1))). That higher rate applies only to income above the bracket line, not to all of it. Choose a state to add state income tax.")
            StatGrid {
                StatTile(label: "Federal income tax", value: Format.currency(c.v(0)))
                StatTile(label: "Average rate on this income", value: Format.percent(c.v(2)))
                StatTile(label: "Rate on the next dollar", value: Format.percent(c.v(1)))
                StatTile(label: "Room before the next bracket", value: c.v(3).isNaN ? "Top bracket" : Format.currency(c.v(3)))
            }
            ChartCard(title: "Where the income goes") {
                Chart([Bar(name: "Kept after federal income tax", value: income - c.v(0)), Bar(name: "Federal income tax", value: c.v(0))]) { b in
                    BarMark(x: .value("Dollars", b.value), y: .value("", "Income"))
                        .foregroundStyle(by: .value("Part", b.name))
                }
                .chartForegroundStyleScale(["Kept after federal income tax": Color.wealthAccent, "Federal income tax": Color.orange])
                .chartXAxis { AxisMarks { v in AxisGridLine(); AxisValueLabel { if let d = v.as(Double.self) { Text(Money.compact(d)) } } } }
                .frame(height: 110)
            }
            HowItWorks(calcs: [c])
        } else { NeedsInput(calc: c) }
    }
}

// MARK: - 6. Market conditions (read-only)

/// A descriptive, read-only view of the RoRo Composite for clients. It shows what the public
/// data says about current conditions. It deliberately leaves out the model's posture label,
/// playbook text and allocation tilts, which read as recommendations.
struct ClientMarketView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var roro: RoRoStore
    struct Pt: Identifiable { let id = UUID(); let date: Date; let value: Double }

    static func word(_ v: Double) -> String { v.isNaN ? "No reading" : (v >= 20 ? "Supportive" : (v <= -20 ? "Stressed" : "Mixed")) }

    static let bucketPlain: [String: String] = [
        "MACRO": "The economy: jobs, production, housing",
        "MONETARY": "Interest rates and financial conditions",
        "TECHNICALS": "Stock market trend and breadth",
        "CREDIT": "Corporate borrowing costs",
        "VOL": "Market volatility",
        "CROSS": "Risk appetite across markets",
    ]

    static let horizonPlain: [(name: String, desc: String)] = [
        ("Fast-moving signals", "Weighted toward market prices and volatility"),
        ("Medium-term signals", "A balance of market and economic data"),
        ("Slow-moving signals", "Weighted toward the economy and interest rates"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PlanningCrumb()
                if let m = roro.model, !(m["horizons"]?.items ?? []).isEmpty {
                    let s = roro.status
                    HStack(spacing: 10) {
                        Eyebrow(text: "Market conditions · \(m["asof"]?.str ?? "")")
                        Text(s.label.uppercased()).font(.caption.weight(.bold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(s.color.opacity(0.14), in: Capsule()).foregroundStyle(s.color)
                            .help(s.detail)
                        Spacer()
                        Button { roro.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }.disabled(roro.running)
                    }
                    // The overall reading is the medium-term dial, the one the model's own posture follows.
                    let horizons = m["horizons"]?.items ?? []
                    let mid = (horizons.count > 1 ? horizons[1] : horizons[0])["value"]?.num ?? .nan
                    (Text("Market conditions look ") + Text(Self.word(mid).lowercased()).foregroundColor(RoRoStyle.color(mid)) + Text(" right now."))
                        .font(.wealthAnswer(44)).foregroundStyle(Color.wealthInk).fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    (Text("Our gauge combines \(Int(m["n_live"]?.num ?? 0)) public economic and market indicators. It reads ")
                     + Text(RoRoStyle.signed(mid)).fontWeight(.semibold).foregroundColor(Color.wealthInk)
                     + Text(" on a scale from −100 (stressed) to +100 (supportive). It describes conditions today. It does not predict returns."))
                        .font(.system(size: 19)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 640, alignment: .leading)
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(horizons.enumerated()), id: \.offset) { i, h in
                            let v = h["value"]?.num ?? .nan
                            let plain: (name: String, desc: String) = i < Self.horizonPlain.count ? Self.horizonPlain[i] : (h["label"]?.str ?? "", "")
                            HStack(alignment: .firstTextBaseline, spacing: 24) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(plain.name).font(.system(size: 17, weight: .medium))
                                    Text(plain.desc).font(.system(size: 14)).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 8)
                                Text(Self.word(v)).font(.system(size: 21, weight: .semibold)).foregroundStyle(RoRoStyle.color(v))
                                Text(RoRoStyle.signed(v)).font(.system(size: 15, weight: .medium)).monospacedDigit().foregroundStyle(.secondary)
                                    .frame(minWidth: 36, alignment: .trailing)
                            }
                            .padding(.vertical, 16)
                            .overlay(alignment: .bottom) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
                        }
                    }
                    .overlay(alignment: .top) { Rectangle().fill(Color.wealthInk).frame(height: 1) }
                    .padding(.top, 4)
                    PlainSection(title: "What is behind it", note: "Each bar summarizes a group of indicators. Left of center is more stressed, right is more supportive.") {
                        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
                            ForEach(Array((m["buckets"]?.items ?? []).enumerated()), id: \.offset) { _, b in
                                let v = b["score"]?.num ?? .nan
                                GridRow {
                                    Text(Self.bucketPlain[b["key"]?.str ?? ""] ?? (b["name"]?.str ?? "")).frame(minWidth: 130, maxWidth: 290, alignment: .leading)
                                    ScoreBar(value: v).frame(minWidth: 110)
                                    Text(Self.word(v)).foregroundStyle(RoRoStyle.color(v)).frame(width: 90, alignment: .leading)
                                }
                            }
                        }
                    }
                    PlainSection(title: "The last two years", note: "The medium-term reading over time. Conditions change; today's reading says nothing certain about tomorrow's.") {
                        let dates = m["history"]?["dates"]?.items.compactMap { DayMath.parse($0.str).map(DayMath.date) } ?? []
                        let pts = zip(dates, m["history"]?["intermediate"]?.items ?? []).compactMap { d, v in v.double.map { Pt(date: d, value: $0) } }
                        Chart {
                            RuleMark(y: .value("Neutral", 0)).foregroundStyle(Color.secondary.opacity(0.5))
                            ForEach(pts) { p in
                                LineMark(x: .value("Date", p.date), y: .value("Reading", p.value)).foregroundStyle(Color.wealthAccent)
                                    .lineStyle(StrokeStyle(lineWidth: 2))
                            }
                        }
                        .chartYScale(domain: -100...100)
                        .frame(height: 220)
                    }
                    HStack(spacing: 14) {
                        Button("Explore a what-if with the risk tool") { state.clientTool = .risk }
                        Button("Full detail (Advisor Mode)") { state.enter(.advisor); state.selection = .roro }.buttonStyle(.plain).foregroundStyle(Color.wealthAccentText)
                    }
                    Text("Sources: Federal Reserve Economic Data (FRED) and delayed market prices from Yahoo Finance's unofficial feed. Readings come from a hand-calibrated model that has not been validated as a predictor of returns. This is general market information, not investment advice or a recommendation.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                } else if roro.model != nil || !roro.running {
                    Text("Market data isn't available right now.").font(.wealthAnswer(44)).fixedSize(horizontal: false, vertical: true)
                    Text(roro.error ?? "It is published every weekday after the US market close. Press Refresh to download it.")
                        .font(.system(size: 19)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button { roro.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }.disabled(roro.running)
                } else {
                    ProgressView("Downloading public market and economic data…").frame(maxWidth: .infinity).padding(40)
                }
                ClientFootnote()
            }
            .padding(.horizontal, 32).padding(.vertical, 28)
            .frame(maxWidth: 1000, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .onAppear { roro.refreshIfStale() }
    }
}

/// A titled section separated by a thin rule, for the plain-language pages (no card).
struct PlainSection<Content: View>: View {
    let title: String
    var note: String? = nil
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: title)
            content
            if let note { Text(note).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(.top, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
    }
}
