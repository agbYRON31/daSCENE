import SwiftUI
import WealthCore

struct ScenariosView: View {
    @EnvironmentObject var state: AppState
    @State private var saving: SessionScenario?

    var body: some View {
        Group {
            if state.session.scenarios.isEmpty {
                ContentUnavailable(title: "No scenarios this session",
                                   message: "In any calculator choose Save ▸ Keep for This Session to hold a set of inputs here while you compare. They are not written to disk and disappear when you quit. Use Open Scenario File to load one you saved earlier.",
                                   symbol: "tray")
            } else {
                List {
                    ForEach(state.session.scenarios) { s in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.name).font(.body.weight(.medium))
                                Text("\(state.calculator(s.calculatorID)?.name ?? s.calculatorID) • \(s.created.formatted(date: .omitted, time: .shortened))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Open") { state.open(s) }
                            Button("Save to File…") { saving = s }
                            Button(role: .destructive) { state.deleteScenario(s) } label: { Image(systemName: "trash") }
                                .buttonStyle(.borderless)
                                .help("Remove from this session")
                        }
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) { state.open(s) }
                    }
                }
            }
        }
        .navigationTitle("Session scenarios")
        .navigationSubtitle("In memory only · cleared when you quit")
        .toolbar {
            Button("Open Scenario File…") { state.openScenarioFile() }
        }
        .sheet(item: $saving) { s in
            SaveScenarioSheet(calculatorID: s.calculatorID, title: s.name, inputs: s.inputs)
        }
    }
}

struct HistoryView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        Group {
            if state.session.history.isEmpty {
                ContentUnavailable(title: "No history this session",
                                   message: "Completed calculations are listed here a moment after you stop typing. The list is kept in memory only and is erased when you quit.",
                                   symbol: "clock")
            } else {
                List {
                    ForEach(state.session.history) { h in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(state.calculator(h.calculatorID)?.name ?? h.calculatorID).font(.body.weight(.medium))
                                Text(h.summary).font(.callout).monospacedDigit()
                                Text(h.date.formatted(date: .omitted, time: .shortened))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Open") { state.open(h) }
                        }
                        .padding(.vertical, 2)
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) { state.open(h) }
                    }
                }
            }
        }
        .navigationTitle("Session history")
        .navigationSubtitle("In memory only · cleared when you quit")
        .toolbar {
            Button("Clear history", role: .destructive) { state.clearHistory() }
                .disabled(state.session.history.isEmpty)
        }
    }
}

/// Explicit, local save of one calculator's inputs, with a warning and optional password.
struct SaveScenarioSheet: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    let calculatorID: String
    @State var title: String
    let inputs: [String: String]
    @State private var protect = false
    @State private var password = ""
    @State private var confirm = ""

    private var passwordOK: Bool { !protect || (password.count >= 8 && password == confirm) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Save scenario to a file").font(.title3.weight(.semibold))
            Label {
                Text("This writes the numbers currently in this calculator to a file on this Mac, in the place you choose. Wealth Desk doesn't upload or sync it, but anyone who can open the file can read it unless you set a password. Don't save real client figures unless your firm permits it.")
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.shield").foregroundStyle(.orange)
            }
            .font(.callout)
            TextField("Scenario name (don't use a person's name)", text: $title)
                .textFieldStyle(.roundedBorder)
            Toggle("Protect with a password (AES-256 encryption)", isOn: $protect)
            if protect {
                SecureField("Password (8 or more characters)", text: $password).textFieldStyle(.roundedBorder)
                SecureField("Repeat password", text: $confirm).textFieldStyle(.roundedBorder)
                Text("There is no way to recover a forgotten password.").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                Button("Choose Location…") {
                    let name = title.trimmingCharacters(in: .whitespaces).isEmpty ? "Scenario" : title
                    if state.saveScenarioFile(calculatorID: calculatorID, title: name, inputs: inputs, password: protect ? password : nil) {
                        dismiss()
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!passwordOK)
            }
        }
        .padding(22)
        .frame(width: 480)
    }
}
