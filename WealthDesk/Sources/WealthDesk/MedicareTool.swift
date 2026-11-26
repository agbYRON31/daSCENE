import SwiftUI
import WealthCore

/// "Going on Medicare": what Part B and drug coverage would cost at this income, where the income tiers
/// sit, and the rules that catch people out. Every figure comes from the audited medicare_premiums and
/// medicare_penalty calculators and the CMS table for the selected year. Mirrors medicareTool() in web/app.js.
struct MedicareTool: View {
    @EnvironmentObject var state: AppState
    static let key = "client.medicare"

    static let fields: [ClientField] = [
        .init(id: "magi", label: "Income two years ago (modified AGI)", range: 0...2_000_000, step: 5_000),
        .init(id: "status", label: "Tax return", range: 1...2, step: 1),
        .init(id: "n", label: "People on Medicare", range: 1...2, step: 1),
        .init(id: "plan", label: "Drug plan premium per person", range: 0...500, step: 5, blank: "0"),
    ]
    static let penaltyFields: [ClientField] = [
        .init(id: "mb", label: "Months you could have had Part B but didn't", range: 0...240, step: 1, blank: "0"),
        .init(id: "md", label: "Months without drug coverage", range: 0...240, step: 1, blank: "0"),
    ]

    static let facts: [(String, String)] = [
        ("When to sign up", "Your first chance is a seven-month window: the three months before the month you turn 65, that month, and the three months after."),
        ("Still working at 65", "If you or your spouse are still working and covered by that employer's group plan (20 or more employees), you can usually wait on Part B without a penalty, then sign up within 8 months after the job or the coverage ends."),
        ("Health savings account", "Contributions have to stop once Medicare starts. If you sign up after 65, Part A is backdated up to six months, so stop contributing six months before you apply."),
        ("Why income from two years ago", "Social Security sets the surcharge from your tax return two years before. After a life-changing event, such as retiring, you can ask it to use a more recent year with form SSA-44."),
    ]

    private func choice(_ id: String, _ label: String, _ options: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary)
            Picker(label, selection: Binding(get: { state.clientRaw(Self.key, id) }, set: { state.setClient(Self.key, id, $0) })) {
                if state.clientRaw(Self.key, id).isEmpty { Text("—").tag("") }
                ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.segmented).labelsHidden()
        }
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
    }

    var body: some View {
        let key = Self.key
        let c = state.clientRun(key, "medicare_premiums", Self.fields)
        let p = state.clientRun(key, "medicare_penalty", Self.penaltyFields)
        ToolLayout(question: ClientSpec.title(.medicare), eyebrow: true) {
            VStack(alignment: .leading, spacing: 0) {
                Rectangle().fill(Color.wealthInk).frame(height: 1)
                MoneyBox(key: key, id: "magi", label: "Income two years ago (modified AGI)")
                choice("status", "Tax return", [("1", "Single"), ("2", "Joint")])
                choice("n", "People on Medicare", [("1", "One"), ("2", "Two")])
                MoneyBox(key: key, id: "plan", label: "Drug plan premium per person", suffix: "/ mo")
            }
            MoreAssumptions(key: key, ids: ["mb", "md"], note: "Only if you signed up late. Leave empty otherwise.") {
                ClientInputs(key: key, calcID: "medicare_penalty", fields: Self.penaltyFields)
            }
        } results: {
            if let c, c.ok, let t = state.engine?.tax {
                answer(c, p, t)
            } else {
                Text("Type in your income to see what Medicare would cost.").font(.wealthAnswer(40)).foregroundStyle(Color.wealthInk)
                    .fixedSize(horizontal: false, vertical: true)
                NeedsInput(calc: c)
            }
        }
    }

    @ViewBuilder private func answer(_ c: ClientCalc, _ p: ClientCalc?, _ t: TaxTable) -> some View {
        let n = state.clientRaw(Self.key, "n") == "2" ? 2.0 : 1.0
        let pens = (p?.ok ?? false) ? p!.v(2) + p!.v(3) : 0
        let monthly = c.v(4) / 12 + n * pens, yearly = monthly * 12
        let m = t.medicare
        let surcharge = c.v(1) - m.partB + c.v(2)
        let status = state.clientRaw(Self.key, "status") == "2" ? "2" : "1"
        let bounds = m.irmaaThresholds[status] ?? []
        let tier = Int(c.v(0))
        let money = { (v: Double) in Format.currency(v) }
        let bold = { (s: String) in Text(s).fontWeight(.semibold).foregroundColor(Color.wealthInk) }
        let head = n == 2 ? "Medicare would cost about \(money(monthly)) a month for the two of you." : "Medicare would cost about \(money(monthly)) a month."
        let sub: Text = {
            var s = bold(Usd.whole(yearly)) + Text(" a year for Part B and drug coverage, before supplemental coverage and out-of-pocket costs")
            s = surcharge > 0 ? s + Text(", including an income-related surcharge of ") + bold(money(surcharge)) + Text(" a month per person.")
                              : s + Text(". No income-related surcharge at this income.")
            if pens > 0 { s = s + Text(" That includes late-enrollment penalties of ") + bold(money(pens)) + Text(" a month per person.") }
            return s
        }()
        let k = { (v: Double) in Usd.whole(v) }
        let ranges: [String] = bounds.count == 5
            ? ["Up to \(k(bounds[0]))"] + (0..<4).map { "\(k(bounds[$0])) – \(k(bounds[$0 + 1]))" } + ["\(k(bounds[4])) or more"] : []
        VStack(alignment: .leading, spacing: 6) {
            Text(head).font(.wealthAnswer(40)).foregroundStyle(Color.wealthInk).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            sub.font(.system(size: 18)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).frame(maxWidth: 600, alignment: .leading)
        }
        PlainSection(title: "\(t.taxYear) income tiers · \(status == "2" ? "joint return" : "single return")",
                     note: (tier >= 5 ? "This is the top tier. " : "You're \(Usd.whole(c.v(6))) below the next tier. One dollar over a line raises the premium for the whole year. ")
                        + "Per person: Part B plus the drug-coverage surcharge, before the drug plan's own premium.") {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Income two years earlier"); Spacer(); Text("Per person, monthly")
                }
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary).padding(.vertical, 6)
                .overlay(alignment: .bottom) { Rectangle().fill(Color.wealthInk).frame(height: 1) }
                ForEach(Array(ranges.enumerated()), id: \.offset) { i, r in
                    HStack(spacing: 10) {
                        Text(r)
                        if i == tier {
                            Text("YOU").font(.system(size: 11, weight: .bold)).padding(.horizontal, 6).padding(.vertical, 1)
                                .background(Color.wealthAccent.opacity(0.14), in: RoundedRectangle(cornerRadius: 3))
                        }
                        Spacer()
                        Text(money(m.partB + m.partBAdjust[i] + m.partDAdjust[i])).monospacedDigit()
                    }
                    .font(.system(size: 16, weight: i == tier ? .semibold : .regular))
                    .foregroundStyle(i == tier ? Color.wealthAccentText : Color.wealthInk)
                    .padding(.vertical, 9)
                    .overlay(alignment: .bottom) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
                }
            }
        }
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Self.facts, id: \.0) { f in
                HStack(alignment: .firstTextBaseline, spacing: 24) {
                    Text(f.0).font(.system(size: 15, weight: .semibold)).frame(width: 200, alignment: .leading)
                    Text(f.1).font(.system(size: 16)).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 14)
                .overlay(alignment: .bottom) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
            }
        }
        .overlay(alignment: .top) { Rectangle().fill(Color.wealthInk).frame(height: 1) }
        addToRetirement(yearly)
        MedicareBreakdown(c: c, p: p, pens: pens, taxYear: t.taxYear, partB: m.partB)
    }

    @ViewBuilder private func addToRetirement(_ yearly: Double) -> some View {
        let spend = state.clientRaw("client.retirement", "spend").trimmingCharacters(in: .whitespaces)
        if spend.isEmpty {
            Text("In “Am I on track for retirement?”, include about \(Usd.whole(yearly)) a year for Medicare in retirement spending.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        } else if state.clientRaw(Self.key, "_added") == spend {
            Text("Added to retirement spending.").font(.callout).foregroundStyle(.secondary)
        } else {
            Text("This uses today's income tier. Income often drops in retirement, which can mean a lower tier.")
                .font(.callout).foregroundStyle(.secondary)
            Button("Add \(Usd.whole(yearly)) a year to retirement spending") {
                let cur = (try? Engine.parseNumber(spend, percent: false)) ?? 0
                let next = Format.plain((cur + yearly).rounded(), maxDecimals: 0)
                state.setClient("client.retirement", "spend", next)
                state.setClient(Self.key, "_added", next)
                state.flash("Retirement spending is now \(Usd.whole(cur + yearly)) a year.")
            }
        }
    }
}

/// "Breakdown and method", folded away under the facts.
struct MedicareBreakdown: View {
    let c: ClientCalc
    let p: ClientCalc?
    let pens: Double
    let taxYear: Int
    let partB: Double
    @State private var open = false

    var body: some View {
        let items: [(String, Double)] = [("Part B, per person", c.v(1)), ("Drug-coverage surcharge, per person", c.v(2)),
                                         ("Drug plan, per person", c.v(3) - c.v(1) - c.v(2)), ("Penalties, per person", pens)]
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.0).font(.system(size: 13)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            Text(Format.currency(item.1)).font(.system(size: 18, weight: .semibold)).monospacedDigit()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Text("Uses CMS's \(String(taxYear)) Part B premium (\(Format.currency(partB))) and income tiers. Part A is assumed premium-free, as it is for about 99% of people. Not included: Medicare Advantage or Medigap premiums, deductibles and other out-of-pocket costs. Sources: the CMS premium fact sheet, Medicare.gov and the Social Security Administration.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                HowItWorks(calcs: (p?.ok ?? false) && pens > 0 ? [c, p!] : [c])
            }
            .padding(.top, 8)
        } label: {
            Text("Breakdown and method").font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary)
        }
        .padding(.top, 10)
        .overlay(alignment: .top) { Rectangle().fill(Color.wealthRule).frame(height: 1) }
    }
}
