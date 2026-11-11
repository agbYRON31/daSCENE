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
        case .growth: return "How does my money grow?"
        case .retirement: return "Am I on track for retirement?"
        case .risk: return "How much investment risk am I taking?"
        case .decisions: return "How do my decisions change my future?"
        case .taxes: return "How do taxes and inflation affect my money?"
        case .market: return "What are market conditions right now?"
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
            .navigationTitle(state.clientTool.map(ClientSpec.title) ?? "Wealth Desk")
            .navigationSubtitle("Client Mode")
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    Button { state.clientTool = nil } label: { Label("All tools", systemImage: "square.grid.2x2") }
                        .help("Back to all the questions")
                        .disabled(state.clientTool == nil)
                }
                ToolbarItem(placement: .navigation) { ModeSwitch() }
                ToolbarItemGroup {
                    Button { exportPDF() } label: { Label("PDF report", systemImage: "doc.richtext") }
                        .help("Save a PDF of this illustration to a location you choose")
                        .disabled(state.clientTool == nil || state.clientTool == .market)
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

struct ClientHome: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        ScrollView {
            VStack(spacing: 26) {
                VStack(spacing: 8) {
                    Text("What would you like to explore?").font(.system(size: 30, weight: .semibold, design: .serif))
                    Text("Pick a question, type in any numbers, and watch the picture change.")
                        .font(.title3).foregroundStyle(.secondary)
                }
                .padding(.top, 18)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 18)], spacing: 18) {
                    ForEach(ClientTool.allCases) { tool in
                        Button { state.clientTool = tool } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                Image(systemName: ClientSpec.symbol(tool)).font(.system(size: 24)).foregroundStyle(Color.wealthAccent)
                                Text(ClientSpec.title(tool)).font(.title3.weight(.semibold)).multilineTextAlignment(.leading)
                                Text(ClientSpec.blurb(tool)).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(22)
                            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
                            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 16))
                            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.primary.opacity(0.08)))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .frame(maxWidth: 1000)
                ClientFootnote()
            }
            .padding(28)
            .frame(maxWidth: .infinity)
        }
    }
}

struct ClientFootnote: View {
    var body: some View {
        Text("These are educational illustrations based only on the numbers typed in. They are not advice, a recommendation or a prediction. Nothing typed here is saved or sent; it is erased when Wealth Desk quits.")
            .font(.caption).foregroundStyle(.tertiary).multilineTextAlignment(.center).frame(maxWidth: 760)
    }
}

// MARK: - Shared pieces

struct ToolLayout<Inputs: View, Results: View>: View {
    let question: String
    @ViewBuilder let inputs: Inputs
    @ViewBuilder let results: Results

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) { inputs }
                    .padding(20)
            }
            .frame(width: 380)
            .background(Color(nsColor: .controlBackgroundColor))
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(question).font(.system(size: 26, weight: .semibold, design: .serif))
                    results
                    ClientFootnote().frame(maxWidth: .infinity)
                }
                .padding(26)
                .frame(maxWidth: 900, alignment: .leading)
                .frame(maxWidth: .infinity)
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
            Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(.secondary)
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
            Text(text).font(.system(size: 21, weight: .medium)).fixedSize(horizontal: false, vertical: true)
            if let caption { Text(caption).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.wealthAccent.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
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
            Text(value).font(.system(size: 24, weight: .semibold, design: .rounded)).monospacedDigit()
                .foregroundStyle(negative ? Color.red : Color.primary).lineLimit(1).minimumScaleFactor(0.6)
            if let caption { Text(caption).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.08)))
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
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14))
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
                        Text(c.calc.assumptions).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        Text(c.calc.interpretation).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        Button("Open the full calculator in Advisor Mode") { state.openInAdvisor(c) }.buttonStyle(.link).font(.caption)
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

struct GrowthTool: View {
    @EnvironmentObject var state: AppState
    struct Pt: Identifiable { let id = UUID(); let year: Double; let value: Double; let part: String }

    var body: some View {
        let c = state.clientRun("client.growth", "growth_schedule", ClientSpec.growth)
        ToolLayout(question: ClientSpec.title(.growth)) {
            InputGroup(title: "Your numbers") {
                ClientInputs(key: "client.growth", calcID: "growth_schedule", fields: Array(ClientSpec.growth.prefix(2)))
            }
            InputGroup(title: "Assumptions", note: "These are yours to set. A return is an assumption, not a promise.") {
                ClientInputs(key: "client.growth", calcID: "growth_schedule", fields: Array(ClientSpec.growth.dropFirst(2)))
            }
        } results: {
            if let c, c.ok, let table = c.eval.table {
                let years = Int(table.rows.last?[0] ?? 0)
                Headline(text: "After \(years) years this could grow to \(Format.currency(c.v(0))).",
                         caption: "\(Format.currency(c.v(1))) is money put in; \(Format.currency(c.v(2))) is growth on top of it.")
                StatGrid {
                    StatTile(label: "Ending balance", value: Format.currency(c.v(0)))
                    StatTile(label: "Money put in", value: Format.currency(c.v(1)))
                    StatTile(label: "Growth earned", value: Format.currency(c.v(2)), negative: c.v(2) < 0)
                    StatTile(label: "What it buys in today's dollars", value: Format.currency(c.v(3)), caption: "After the inflation entered")
                }
                ChartCard(title: "Year by year", note: "Growth compounds: each year's gains earn gains of their own.") {
                    let pts = table.rows.flatMap { r in [Pt(year: r[0], value: r[1], part: "Money put in"), Pt(year: r[0], value: max(r[2], 0), part: "Growth")] }
                    Chart {
                        ForEach(pts) { p in
                            AreaMark(x: .value("Year", p.year), y: .value("Balance", p.value), stacking: .standard)
                                .foregroundStyle(by: .value("Part", p.part))
                        }
                        ForEach(table.rows, id: \.self) { r in
                            LineMark(x: .value("Year", r[0]), y: .value("Balance", r[4]), series: .value("Line", "today"))
                                .foregroundStyle(Color.primary.opacity(0.6))
                                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                        }
                    }
                    .chartForegroundStyleScale(["Money put in": Color.gray.opacity(0.45), "Growth": Color.wealthAccent])
                    .chartYAxis { moneyAxis() }
                    .chartXAxisLabel("Years from now")
                    .frame(height: 260)
                    Text("Dashed line: the balance in today's dollars.").font(.caption).foregroundStyle(.secondary)
                }
                HowItWorks(calcs: [c])
            } else {
                NeedsInput(calc: c)
            }
        }
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
            InputGroup(title: "Assumptions", note: "Leave volatility empty for a single steady path, or enter it to see a range of outcomes.") {
                ClientInputs(key: "client.retirement", calcID: "retirement_mc", fields: ClientSpec.retirementAssumptions)
            }
        } results: {
            if let t, t.ok, let table = t.eval.table {
                let plan = (table.rows.last?[0] ?? 0) + 1
                let lasts = t.v(3) < 0
                let rate = t.v(0) > 0 ? t.v(1) / t.v(0) : .nan
                Headline(text: lasts ? "On this steady path the money lasts through age \(Int(plan))."
                                     : "On this steady path the money runs out around age \(Int(t.v(3))).",
                         caption: lasts ? "About \(Format.currency(t.v(2))) would remain at the end of the plan."
                                        : "That is \(Int(plan - t.v(3))) years before the end of the plan.")
                StatGrid {
                    StatTile(label: "Savings at retirement", value: Format.currency(t.v(0)))
                    StatTile(label: "First-year withdrawal", value: Format.currency(t.v(1)),
                             caption: rate.isNaN ? nil : "\(Format.percent(rate)) of savings at retirement")
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
                if let mc, !mc.ok, hasVol { NeedsInput(calc: mc) }
                HowItWorks(calcs: [t] + (mc?.ok == true ? [mc!] : []))
            } else {
                NeedsInput(calc: t)
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
                ClientInputs(key: "client.risk", calcID: "portfolio_stress", fields: Array(ClientSpec.risk.dropFirst(3)))
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
                        .buttonStyle(.link)
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
                .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14))
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
                InputGroup(title: "Federal income tax estimate", note: "Federal tax on ordinary taxable income only. No state tax, credits or other taxes.") {
                    ClientInputs(key: "client.incometax", calcID: "income_tax", fields: ClientSpec.incomeTax)
                    if let f = state.calculator("income_tax")?.fields.first(where: { $0.id == "status" }), let options = f.options {
                        Picker("Filing status", selection: Binding(get: { state.clientRaw("client.incometax", "status").isEmpty ? f.example : state.clientRaw("client.incometax", "status") },
                                                                   set: { state.setClient("client.incometax", "status", $0) })) {
                            ForEach(options, id: \.value) { Text($0.label).tag(Format.plain($0.value)) }
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
        if let c, c.ok, case .number(let income)? = try? Engine.parse(c.inputs["ti"] ?? "", field: c.calc.fields[0]) {
            Headline(text: "Estimated federal income tax: \(Format.currency(c.v(0))), which is \(Format.percent(c.v(2))) of this income.",
                     caption: "The next dollar earned would be taxed at \(Format.percent(c.v(1))). That higher rate applies only to income above the bracket line, not to all of it.")
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(ClientSpec.title(.market)).font(.system(size: 26, weight: .semibold, design: .serif))
                if let m = roro.model {
                    let s = roro.status
                    HStack(spacing: 10) {
                        Text(s.label.uppercased()).font(.caption.weight(.bold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(s.color.opacity(0.18), in: Capsule()).foregroundStyle(s.color)
                        Text(s.detail).font(.callout).foregroundStyle(.secondary)
                        Spacer()
                        Button { roro.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }.disabled(roro.running)
                    }
                    let mid = m["horizons"]?[1]?["value"]?.num ?? .nan
                    Headline(text: "Overall, the indicators read “\(Self.word(mid).lowercased())” right now.",
                             caption: "This summarizes \(Int(m["n_live"]?.num ?? 0)) public economic and market indicators on a scale from −100 (stressed) to +100 (supportive). It describes conditions today. It does not predict returns and is not advice about any portfolio.")
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(Array((m["horizons"]?.items ?? []).enumerated()), id: \.offset) { i, h in
                            let v = h["value"]?.num ?? .nan
                            VStack(alignment: .leading, spacing: 8) {
                                Text(["Fast-moving signals", "Medium-term signals", "Slow-moving signals"][min(i, 2)]).font(.callout).foregroundStyle(.secondary)
                                HStack(alignment: .firstTextBaseline) {
                                    Text(Self.word(v)).font(.system(size: 22, weight: .semibold, design: .rounded)).foregroundStyle(RoRoStyle.color(v))
                                    Spacer()
                                    Text(RoRoStyle.signed(v)).monospacedDigit().foregroundStyle(.secondary)
                                }
                                ScoreBar(value: v)
                                Text(["Weighted toward market prices and volatility", "A balance of market and economic data", "Weighted toward the economy and interest rates"][min(i, 2)])
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.08)))
                        }
                    }
                    ChartCard(title: "What is behind it", note: "Each bar summarizes a group of indicators. Left of center is more stressed, right is more supportive.") {
                        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
                            ForEach(Array((m["buckets"]?.items ?? []).enumerated()), id: \.offset) { _, b in
                                let v = b["score"]?.num ?? .nan
                                GridRow {
                                    Text(Self.bucketPlain[b["key"]?.str ?? ""] ?? (b["name"]?.str ?? "")).frame(width: 290, alignment: .leading)
                                    ScoreBar(value: v).frame(minWidth: 180)
                                    Text(Self.word(v)).foregroundStyle(RoRoStyle.color(v)).frame(width: 90, alignment: .leading)
                                }
                            }
                        }
                    }
                    ChartCard(title: "The last two years", note: "The medium-term reading over time. Conditions change; today's reading says nothing certain about tomorrow's.") {
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
                        Button("Full detail (Advisor Mode)") { state.enter(.advisor); state.selection = .roro }.buttonStyle(.link)
                    }
                    Text("Sources: Federal Reserve Economic Data (FRED) and delayed market prices from Yahoo Finance's unofficial feed. Readings come from a hand-calibrated model that has not been validated as a predictor of returns. This is general market information, not investment advice or a recommendation.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                } else if roro.running {
                    ProgressView("Downloading public market and economic data…").frame(maxWidth: .infinity).padding(40)
                } else {
                    Headline(text: "Market data isn't available right now.", caption: roro.error ?? "Press Refresh to download it.")
                    Button { roro.refresh() } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                }
                ClientFootnote().frame(maxWidth: .infinity)
            }
            .padding(26)
            .frame(maxWidth: 960, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .onAppear { roro.refreshIfStale() }
    }
}
