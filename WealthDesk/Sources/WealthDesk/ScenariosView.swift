import SwiftUI
import WealthCore

struct ScenariosView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        Group {
            if state.workspace.scenarios.isEmpty {
                ContentUnavailable(title: "No saved scenarios",
                                   message: "Open any calculator, enter your values, then choose Save scenario (⌘S). Working inputs also save automatically.",
                                   symbol: "tray")
            } else {
                List {
                    ForEach(state.workspace.scenarios) { s in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.name).font(.body.weight(.medium))
                                Text("\(state.calculator(s.calculatorID)?.name ?? s.calculatorID) • \(s.created.formatted(date: .abbreviated, time: .shortened))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Open") { state.open(s) }
                            Button(role: .destructive) { state.deleteScenario(s) } label: { Image(systemName: "trash") }
                                .buttonStyle(.borderless)
                                .help("Delete saved scenario")
                        }
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) { state.open(s) }
                    }
                }
            }
        }
        .navigationTitle("Saved scenarios")
        .navigationSubtitle("\(state.workspace.scenarios.count) saved")
    }
}

struct HistoryView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        Group {
            if state.workspace.history.isEmpty {
                ContentUnavailable(title: "No history yet",
                                   message: "Completed calculations are recorded here a moment after you stop typing.",
                                   symbol: "clock")
            } else {
                List {
                    ForEach(state.workspace.history) { h in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(state.calculator(h.calculatorID)?.name ?? h.calculatorID).font(.body.weight(.medium))
                                Text(h.summary).font(.callout).monospacedDigit()
                                Text(h.date.formatted(date: .abbreviated, time: .shortened))
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
        .navigationTitle("History")
        .toolbar {
            Button("Clear history", role: .destructive) { state.clearHistory() }
                .disabled(state.workspace.history.isEmpty)
        }
    }
}
