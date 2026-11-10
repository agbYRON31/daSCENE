import AppKit
import SwiftUI
import WealthCore

/// Free-form calculator: type or tap an expression, press = or Return.
/// Basic and Scientific keypads, degree/radian switch, `ans`, variables (x = 5) and a history tape.
struct CalculatorPadView: View {
    @EnvironmentObject var state: AppState
    @State private var line = ""
    @State private var error: String?
    @FocusState private var focused: Bool

    private var ans: Double? { state.workspace.tape.first?.result }

    /// Live preview of the current line (nil when incomplete or invalid).
    private var preview: Double? {
        guard let tax = state.engine?.tax, !line.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return try? Scientific.evaluate(line, variables: state.workspace.variables, ans: ans,
                                        degrees: state.workspace.calcDegrees, tax: tax).value
    }

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 14) {
                header
                display
                keypad
                Text(helpText).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .frame(minWidth: 380, maxWidth: 520)
            tapePanel.frame(minWidth: 240, maxWidth: 340)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .navigationTitle("Calculator")
        .navigationSubtitle(state.workspace.calcScientific ? "Scientific" : "Basic")
        .onAppear { focused = true }
    }

    private var helpText: String {
        "Type with the keyboard or tap the keys. Return or = evaluates; Esc clears. Use ans for the last result, or name a value with x = 5 and use it later. " +
        (state.workspace.calcScientific ? "Functions: sin cos tan asin acos atan sinh cosh tanh, ln log log2 log(x, b), sqrt cbrt exp, abs round mod, fact ncr npr, pi e." : "")
    }

    // MARK: Header

    private var header: some View {
        HStack {
            Picker("", selection: $state.workspace.calcScientific) {
                Text("Basic").tag(false)
                Text("Scientific").tag(true)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 200)
            Spacer()
            if state.workspace.calcScientific {
                Picker("", selection: $state.workspace.calcDegrees) {
                    Text("Deg").tag(true)
                    Text("Rad").tag(false)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 110)
                .help("Angle unit for sin, cos, tan and their inverses")
            }
        }
    }

    // MARK: Display

    private var display: some View {
        VStack(alignment: .trailing, spacing: 6) {
            TextField("0", text: $line)
                .textFieldStyle(.plain)
                .font(.system(size: 22, weight: .regular, design: .monospaced))
                .multilineTextAlignment(.trailing)
                .focused($focused)
                .onSubmit(evaluate)
                .onExitCommand { line = ""; error = nil }
                .onChange(of: line) { _ in error = nil }
            Group {
                if let error {
                    Text(error).foregroundStyle(.red).font(.callout)
                } else if let p = preview {
                    Text("= " + Scientific.display(p))
                        .font(.system(size: 30, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .textSelection(.enabled)
                } else {
                    Text(ans.map { "ans = " + Scientific.display($0) } ?? " ")
                        .font(.callout).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            .frame(minHeight: 38)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.primary.opacity(0.08)))
    }

    // MARK: Keypad

    private enum KeyKind { case digit, op, fn, action, equals }

    private struct Key: Identifiable {
        let label: String
        let insert: String
        var kind: KeyKind = .fn
        var id: String { label }
    }

    private let basicRows: [[Key]] = [
        [Key(label: "C", insert: "C", kind: .action), Key(label: "⌫", insert: "⌫", kind: .action), Key(label: "( )", insert: "()", kind: .action), Key(label: "÷", insert: " ÷ ", kind: .op)],
        [Key(label: "7", insert: "7", kind: .digit), Key(label: "8", insert: "8", kind: .digit), Key(label: "9", insert: "9", kind: .digit), Key(label: "×", insert: " × ", kind: .op)],
        [Key(label: "4", insert: "4", kind: .digit), Key(label: "5", insert: "5", kind: .digit), Key(label: "6", insert: "6", kind: .digit), Key(label: "−", insert: " − ", kind: .op)],
        [Key(label: "1", insert: "1", kind: .digit), Key(label: "2", insert: "2", kind: .digit), Key(label: "3", insert: "3", kind: .digit), Key(label: "+", insert: " + ", kind: .op)],
        [Key(label: "±", insert: "±", kind: .action), Key(label: "0", insert: "0", kind: .digit), Key(label: ".", insert: ".", kind: .digit), Key(label: "=", insert: "=", kind: .equals)],
    ]

    private let sciRows: [[Key]] = [
        [Key(label: "sin", insert: "sin("), Key(label: "cos", insert: "cos("), Key(label: "tan", insert: "tan("), Key(label: "ln", insert: "ln("), Key(label: "log", insert: "log(")],
        [Key(label: "sin⁻¹", insert: "asin("), Key(label: "cos⁻¹", insert: "acos("), Key(label: "tan⁻¹", insert: "atan("), Key(label: "eˣ", insert: "exp("), Key(label: "10ˣ", insert: "10^(")],
        [Key(label: "x²", insert: "^2"), Key(label: "xʸ", insert: "^"), Key(label: "√", insert: "sqrt("), Key(label: "∛", insert: "cbrt("), Key(label: "1/x", insert: "1/(")],
        [Key(label: "π", insert: "pi"), Key(label: "e", insert: "e"), Key(label: "n!", insert: "fact("), Key(label: "nCr", insert: "ncr("), Key(label: "%", insert: "/100")],
        [Key(label: "|x|", insert: "abs("), Key(label: "mod", insert: "mod("), Key(label: ",", insert: ", "), Key(label: "ans", insert: "ans"), Key(label: "EE", insert: "*10^")],
    ]

    private var keypad: some View {
        VStack(spacing: 8) {
            if state.workspace.calcScientific {
                Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                    ForEach(sciRows.indices, id: \.self) { r in
                        GridRow { ForEach(sciRows[r]) { keyButton($0, height: 34) } }
                    }
                }
                Divider().padding(.vertical, 2)
            }
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                ForEach(basicRows.indices, id: \.self) { r in
                    GridRow { ForEach(basicRows[r]) { keyButton($0, height: 44) } }
                }
            }
        }
    }

    private func keyButton(_ key: Key, height: CGFloat) -> some View {
        Button { press(key) } label: {
            Text(key.label)
                .font(key.kind == .fn ? .system(size: 14, weight: .medium) : .system(size: 20, weight: .medium, design: .rounded))
                .frame(maxWidth: .infinity, minHeight: height)
                .background(background(key.kind), in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(key.kind == .equals ? Color.white : (key.kind == .op ? Color.wealthAccent : Color.primary))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(key.insert.trimmingCharacters(in: .whitespaces))
    }

    private func background(_ kind: KeyKind) -> Color {
        switch kind {
        case .equals: return .wealthAccent
        case .op: return Color.wealthAccent.opacity(0.12)
        case .digit: return Color.primary.opacity(0.07)
        case .action: return Color.primary.opacity(0.12)
        case .fn: return Color.primary.opacity(0.05)
        }
    }

    private func press(_ key: Key) {
        error = nil
        switch key.insert {
        case "=": evaluate()
        case "C": line = ""
        case "⌫": if !line.isEmpty { line.removeLast(); while line.hasSuffix(" ") { line.removeLast() } }
        case "()":
            let opens = line.filter { $0 == "(" }.count, closes = line.filter { $0 == ")" }.count
            let last = line.trimmingCharacters(in: .whitespaces).last
            line += (opens > closes && last.map { $0.isNumber || $0 == ")" || $0.isLetter } == true) ? ")" : "("
        case "±":
            line = line.hasPrefix("−(") && line.hasSuffix(")") ? String(line.dropFirst(2).dropLast()) : (line.isEmpty ? "−" : "−(\(line))")
        default:
            // After a completed result, typing an operator continues from ans; a digit starts fresh.
            if line.isEmpty, key.kind == .op, ans != nil { line = "ans" }
            line += key.insert
        }
        focused = true
    }

    private func evaluate() {
        guard let tax = state.engine?.tax else { return }
        let text = line.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        do {
            let r = try Scientific.evaluate(text, variables: state.workspace.variables, ans: ans,
                                            degrees: state.workspace.calcDegrees, tax: tax)
            if let name = r.assignedName { state.workspace.variables[name] = r.value }
            state.workspace.tape.insert(TapeEntry(expression: text, result: r.value, assigned: r.assignedName), at: 0)
            if state.workspace.tape.count > 300 { state.workspace.tape.removeLast(state.workspace.tape.count - 300) }
            line = ""
        } catch {
            self.error = error.localizedDescription
        }
        focused = true
    }

    // MARK: Tape & variables

    private var tapePanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !state.workspace.variables.isEmpty {
                Card(title: "Variables", trailing: AnyView(Button("Clear") { state.workspace.variables.removeAll() }.buttonStyle(.link))) {
                    ForEach(state.workspace.variables.keys.sorted(), id: \.self) { k in
                        Button { line += k; focused = true } label: {
                            HStack {
                                Text(k).font(.system(.body, design: .monospaced).weight(.semibold))
                                Spacer()
                                Text(Scientific.display(state.workspace.variables[k]!)).monospacedDigit().foregroundStyle(.secondary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("Insert \(k)")
                    }
                }
            }
            Card(title: "History", trailing: AnyView(Button("Clear") { state.workspace.tape.removeAll() }
                .buttonStyle(.link).disabled(state.workspace.tape.isEmpty))) {
                if state.workspace.tape.isEmpty {
                    Text("Results appear here. Click one to reuse it.").font(.callout).foregroundStyle(.secondary)
                } else {
                    ScrollView {
                        LazyVStack(alignment: .trailing, spacing: 10) {
                            ForEach(state.workspace.tape) { e in
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text((e.assigned.map { "\($0) = " } ?? "") + e.expression)
                                        .font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                                        .lineLimit(2).multilineTextAlignment(.trailing)
                                    Text(Scientific.display(e.result)).font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit()
                                }
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .contentShape(Rectangle())
                                .onTapGesture { line += plain(e.result); focused = true }
                                .contextMenu {
                                    Button("Insert result") { line += plain(e.result) }
                                    Button("Copy result") { state.copy(plain(e.result)) }
                                    Button("Edit expression") { line = e.expression }
                                }
                                .help("Click to insert this result")
                                Divider()
                            }
                        }
                    }
                    .frame(maxHeight: 460)
                }
            }
        }
    }

    /// Full-precision, ungrouped text for re-use in an expression.
    private func plain(_ v: Double) -> String {
        var s = String(v)
        if s.hasSuffix(".0") { s.removeLast(2) }
        return s
    }
}
