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
    @StateObject private var keys = CalcKeyController()
    /// Position while stepping through history with ↑/↓, and the line that was being typed before.
    @State private var recall: Int?
    @State private var draft = ""
    /// Set while the app (not the user) changes `line`, so typing rules don't fire on it.
    @State private var programmatic = false
    @State private var lastLine = ""

    private var ans: Double? { state.session.tape.first?.result }

    /// Live preview of the current line (nil when incomplete or invalid).
    private var preview: Double? {
        guard let tax = state.engine?.tax, !line.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return try? Scientific.evaluate(line, variables: state.session.variables, ans: ans,
                                        degrees: state.prefs.calcDegrees, tax: tax).value
    }

    private var padColumn: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            display
            keypad
            Text(helpText).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 18) {
                padColumn.frame(minWidth: 380, maxWidth: 520)
                tapePanel.frame(minWidth: 240, maxWidth: 340)
            }
            // Small window: keypad only, scrolling if it has to; the tape returns when there is room.
            ScrollView { padColumn.frame(maxWidth: 520) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .navigationTitle("Calculator")
        .navigationSubtitle(state.prefs.calcScientific ? "Scientific" : "Basic")
        .background(CalcKeyAnchor(controller: keys, handler: handleKey))
        .onAppear { focusLine() }
    }

    private var helpText: String {
        "Type with the keyboard or tap the keys. Return or = evaluates, Esc clears, ↑ and ↓ bring back earlier lines. " +
        "x or * multiplies (5 x 3), 250k / 1.2m / 3b are thousands, millions and billions, and 15% is 0.15. " +
        "Use ans for the last result, or name a value with x = 5 and use it later (2x, x^2). " +
        (state.prefs.calcScientific ? "Functions: sin cos tan asin acos atan sinh cosh tanh, ln log log2 log(x, b), sqrt cbrt exp, abs round mod, fact ncr npr, pi e." : "")
    }

    // MARK: Header

    private var header: some View {
        HStack {
            Picker("", selection: $state.prefs.calcScientific) {
                Text("Basic").tag(false)
                Text("Scientific").tag(true)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 200)
            Spacer()
            if state.prefs.calcScientific {
                Picker("", selection: $state.prefs.calcDegrees) {
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
                .onChange(of: line, perform: lineChanged)
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
        /// Keys that need a value on their left; on an empty line they continue from the last result.
        var continuesAns: Bool { kind == .op || ["^2", "^", "/100", "*10^"].contains(insert) }
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
            if state.prefs.calcScientific {
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
        case "=": evaluate(); return
        case "C": setLine("")
        case "⌫": setLine(Self.backspaced(line))
        case "()":
            let opens = line.filter { $0 == "(" }.count, closes = line.filter { $0 == ")" }.count
            let last = line.trimmingCharacters(in: .whitespaces).last
            setLine(line + ((opens > closes && last.map { $0.isNumber || $0 == ")" || $0.isLetter } == true) ? ")" : "("))
        case "±":
            setLine(line.hasPrefix("−(") && line.hasSuffix(")") ? String(line.dropFirst(2).dropLast()) : (line.isEmpty ? "−" : "−(\(line))"))
        default:
            // After a completed result, an operator continues from ans; a digit starts fresh.
            var base = line
            if base.trimmingCharacters(in: .whitespaces).isEmpty, key.continuesAns, ans != nil { base = "ans" }
            setLine(base + key.insert)
        }
        focusLine()
    }

    /// Keypad ⌫: removes one character, or a whole inserted piece like "sin(", " × " or "*10^".
    static func backspaced(_ s: String) -> String {
        var t = s
        while t.last == " " { t.removeLast() }
        if t.hasSuffix("*10^") || t.hasSuffix("/100") {
            t.removeLast(4)
        } else if let r = t.range(of: "[A-Za-z_][A-Za-z0-9_]*\\($", options: .regularExpression) {
            t.removeSubrange(r)
        } else if !t.isEmpty {
            t.removeLast()
        }
        while t.last == " " { t.removeLast() }
        return t
    }

    /// Changes the line from code (keypad, history, clearing) without triggering the typing rules.
    private func setLine(_ s: String) {
        recall = nil
        guard s != line else { return }
        programmatic = true
        line = s
    }

    /// Focuses the line and puts the cursor at the end. (Focusing a Mac text field selects all of
    /// its text, so without this the next key typed would replace everything.)
    private func focusLine() {
        focused = true
        keys.caretToEnd()
    }

    /// Rules for what the user types into the line.
    private func lineChanged(_ new: String) {
        error = nil
        defer { lastLine = line }
        if programmatic { programmatic = false; keys.caretToEnd(); return }
        recall = nil
        // "=" typed on the keyboard evaluates, except right after a name ("x =" is the start of x = 5).
        if new.hasSuffix("=") {
            let before = new.dropLast().trimmingCharacters(in: .whitespaces)
            if let b = before.last, !"<>!=".contains(b),
               !Scientific.isName(before) || Scientific.reserved.contains(before) {
                evaluate(); return
            }
        }
        // An operator typed first after a result continues from it, like the keypad.
        if lastLine.isEmpty, ans != nil, new.count == 1, "+*/^×÷".contains(new) {
            setLine("ans " + new + " ")
        }
    }

    /// Keys a plain text field doesn't handle: ↑/↓ history, Esc, and typing while the line isn't focused.
    /// Returns true when the key was used here.
    private func handleKey(_ e: NSEvent) -> Bool {
        let mods = e.modifierFlags.intersection([.command, .control])
        guard mods.isEmpty else { return false }          // ⌘ and ⌃ shortcuts work as usual
        let responder = keys.view?.window?.firstResponder
        let editingElsewhere = !focused && responder is NSTextView   // e.g. the sidebar search box
        if editingElsewhere { return false }
        let inList = !focused && responder is NSTableView           // the sidebar list keeps its arrows
        switch e.keyCode {
        case 53:                                                     // Esc
            setLine(""); error = nil; focusLine(); return true
        case 126 where !inList:                                      // ↑
            stepHistory(older: true); return true
        case 125 where !inList:                                      // ↓
            stepHistory(older: false); return true
        default: break
        }
        if focused { return false }                                  // normal typing goes to the line
        switch e.keyCode {
        case 36, 76: evaluate(); focusLine(); return true            // Return / keypad Enter
        case 51: setLine(Self.backspaced(line)); focusLine(); return true
        default: break
        }
        // Not focused (after clicking the sidebar or the background): send calculator keys to the line.
        guard let chars = e.characters, !chars.isEmpty,
              chars.allSatisfy({ $0.isLetter || $0.isNumber || " .,+-*/^()%=×÷−_".contains($0) }) else { return false }
        if chars == "=" { evaluate(); focusLine(); return true }
        var base = line
        if base.isEmpty, ans != nil, "+*/^×÷".contains(chars) { base = "ans " }
        setLine(base + chars)
        focusLine()
        return true
    }

    private func stepHistory(older: Bool) {
        let tape = state.session.tape
        guard !tape.isEmpty else { focusLine(); return }
        var next: Int?
        if older { next = recall.map { min($0 + 1, tape.count - 1) } ?? 0 }
        else if let r = recall { next = r > 0 ? r - 1 : nil }
        else { focusLine(); return }
        if recall == nil { draft = line }
        let text = next.map { tape[$0].expression } ?? draft
        if text != line { programmatic = true; line = text }
        recall = next
        focusLine()
    }

    private func evaluate() {
        guard let tax = state.engine?.tax else { return }
        let text = Scientific.stripTrailingEquals(line.trimmingCharacters(in: .whitespaces))
        guard !text.isEmpty else { setLine(""); return }
        do {
            let r = try Scientific.evaluate(text, variables: state.session.variables, ans: ans,
                                            degrees: state.prefs.calcDegrees, tax: tax)
            if let name = r.assignedName { state.session.variables[name] = r.value }
            state.session.tape.insert(TapeEntry(expression: text, result: r.value, assigned: r.assignedName), at: 0)
            if state.session.tape.count > 300 { state.session.tape.removeLast(state.session.tape.count - 300) }
            setLine("")
        } catch {
            setLine(text)                 // drop a trailing "=" so typing can continue
            self.error = error.localizedDescription
        }
        focusLine()
    }

    /// Adds a value (from history or a variable) to the line. Negative numbers get brackets.
    private func insertValue(_ s: String) {
        setLine(line + (s.hasPrefix("-") ? "(\(s))" : s))
        focusLine()
    }

    // MARK: Tape & variables

    private var tapePanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !state.session.variables.isEmpty {
                Card(title: "Variables", trailing: AnyView(Button("Clear") { state.session.variables.removeAll() }.buttonStyle(.link))) {
                    ForEach(state.session.variables.keys.sorted(), id: \.self) { k in
                        Button { insertValue(k) } label: {
                            HStack {
                                Text(k).font(.system(.body, design: .monospaced).weight(.semibold))
                                Spacer()
                                Text(Scientific.display(state.session.variables[k]!)).monospacedDigit().foregroundStyle(.secondary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("Insert \(k)")
                    }
                }
            }
            Card(title: "History", trailing: AnyView(Button("Clear") { state.session.tape.removeAll() }
                .buttonStyle(.link).disabled(state.session.tape.isEmpty))) {
                if state.session.tape.isEmpty {
                    Text("Results appear here. Click one to reuse it.").font(.callout).foregroundStyle(.secondary)
                } else {
                    ScrollView {
                        LazyVStack(alignment: .trailing, spacing: 10) {
                            ForEach(state.session.tape) { e in
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(e.expression)
                                        .font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
                                        .lineLimit(2).multilineTextAlignment(.trailing)
                                    Text(Scientific.display(e.result)).font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit()
                                }
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .contentShape(Rectangle())
                                .onTapGesture { insertValue(plain(e.result)) }
                                .contextMenu {
                                    Button("Insert result") { insertValue(plain(e.result)) }
                                    Button("Copy result") { state.copy(plain(e.result)) }
                                    Button("Edit expression") { setLine(e.expression); focusLine() }
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

/// Holds the calculator page's key monitor and the view it lives in.
final class CalcKeyController: ObservableObject {
    weak var view: NSView?
    var handler: ((NSEvent) -> Bool)?
    private var monitor: Any?

    func install() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, let window = self.view?.window, event.window === window,
                  window.isKeyWindow, window.attachedSheet == nil else { return event }
            return self.handler?(event) == true ? nil : event
        }
    }

    func remove() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    /// Moves the text cursor to the end of the field being edited, once focus has settled.
    func caretToEnd() {
        for delay in [0.0, 0.05] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let tv = self?.view?.window?.firstResponder as? NSTextView else { return }
                let end = (tv.string as NSString).length
                if tv.selectedRange() != NSRange(location: end, length: 0) { tv.setSelectedRange(NSRange(location: end, length: 0)) }
            }
        }
    }

    deinit { remove() }
}

/// Invisible view that gives the key monitor a window to watch; removed with the page.
struct CalcKeyAnchor: NSViewRepresentable {
    let controller: CalcKeyController
    let handler: (NSEvent) -> Bool

    func makeNSView(context: Context) -> NSView {
        let v = NSView(frame: .zero)
        controller.view = v
        controller.handler = handler
        controller.install()
        return v
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        controller.view = nsView
        controller.handler = handler
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: ()) {}
}
