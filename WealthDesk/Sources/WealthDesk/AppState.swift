import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers
import WealthCore

struct SavedScenario: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    var calculatorID: String
    var inputs: [String: String]
    var created: Date
}

struct HistoryItem: Codable, Identifiable, Hashable {
    var id = UUID()
    var calculatorID: String
    var inputs: [String: String]
    var summary: String
    var date: Date
}

struct Workspace: Codable {
    var version = 1
    var favorites: [String] = []
    var working: [String: [String: String]] = [:]
    var scenarios: [SavedScenario] = []
    var history: [HistoryItem] = []
    var pinned = false
    var lastSelection: String? = nil
}

enum SidebarItem: Hashable {
    case calc(String)
    case scenarios
    case history
}

@MainActor
final class AppState: ObservableObject {
    let engine: Engine?
    let loadError: String?
    @Published var workspace = Workspace() { didSet { scheduleSave() } }
    @Published var selection: SidebarItem? = .calc("fv_lump")
    @Published var search = ""
    @Published var toast: String?

    private var saveWork: DispatchWorkItem?
    private var toastWork: DispatchWorkItem?

    static let historyLimit = 200

    init() {
        do {
            let (catalog, tax) = try AppState.resourceURLs()
            engine = try Engine(catalogURL: catalog, taxURL: tax)
            loadError = nil
        } catch {
            engine = nil
            loadError = "Couldn't load the formula catalog: \(error.localizedDescription)"
        }
        loadWorkspace()
        if let last = workspace.lastSelection, engine?.calculator(last) != nil {
            selection = .calc(last)
        }
    }

    // MARK: Resources

    static func resourceURLs() throws -> (URL, URL) {
        if let c = Bundle.main.url(forResource: "catalog", withExtension: "json"),
           let t = Bundle.main.url(forResource: "taxdata", withExtension: "json") {
            return (c, t)
        }
        // Development fallback (`swift run`): look for Resources/ above the executable or cwd.
        var candidates: [URL] = [URL(fileURLWithPath: FileManager.default.currentDirectoryPath)]
        var dir = Bundle.main.executableURL?.deletingLastPathComponent()
        for _ in 0..<6 {
            if let d = dir { candidates.append(d); dir = d.deletingLastPathComponent() }
        }
        for base in candidates {
            let c = base.appendingPathComponent("Resources/catalog.json")
            let t = base.appendingPathComponent("Resources/taxdata.json")
            if FileManager.default.fileExists(atPath: c.path) && FileManager.default.fileExists(atPath: t.path) {
                return (c, t)
            }
        }
        throw EvalError.message("catalog.json not found")
    }

    var calculators: [Calculator] { engine?.calculators ?? [] }
    var categories: [String] { CatalogLoader.categories(calculators) }

    func calculator(_ id: String) -> Calculator? { engine?.calculator(id) }

    // MARK: Inputs

    func inputs(for calc: Calculator) -> [String: String] {
        workspace.working[calc.id] ?? calc.exampleInputs
    }

    func setInput(_ calc: Calculator, _ field: String, _ value: String) {
        var current = inputs(for: calc)
        current[field] = value
        workspace.working[calc.id] = current
    }

    func resetToExample(_ calc: Calculator) {
        workspace.working[calc.id] = calc.exampleInputs
    }

    func clearInputs(_ calc: Calculator) {
        var blank: [String: String] = [:]
        for f in calc.fields { blank[f.id] = f.isChoice ? f.example : "" }
        workspace.working[calc.id] = blank
    }

    func select(_ calc: Calculator) {
        selection = .calc(calc.id)
        workspace.lastSelection = calc.id
    }

    // MARK: Favorites, scenarios, history

    func isFavorite(_ id: String) -> Bool { workspace.favorites.contains(id) }

    func toggleFavorite(_ id: String) {
        if let i = workspace.favorites.firstIndex(of: id) { workspace.favorites.remove(at: i) } else { workspace.favorites.append(id) }
    }

    func saveScenario(_ calc: Calculator, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        workspace.scenarios.insert(SavedScenario(name: trimmed.isEmpty ? calc.name : trimmed, calculatorID: calc.id,
                                                 inputs: inputs(for: calc), created: Date()), at: 0)
        flash("Scenario saved on this Mac.")
    }

    func open(_ scenario: SavedScenario) {
        workspace.working[scenario.calculatorID] = scenario.inputs
        selection = .calc(scenario.calculatorID)
        workspace.lastSelection = scenario.calculatorID
    }

    func deleteScenario(_ s: SavedScenario) { workspace.scenarios.removeAll { $0.id == s.id } }

    func open(_ item: HistoryItem) {
        workspace.working[item.calculatorID] = item.inputs
        selection = .calc(item.calculatorID)
    }

    func recordHistory(_ calc: Calculator, inputs: [String: String], evaluation: Evaluation) {
        guard evaluation.isComplete, let first = evaluation.outputs.first(where: { $0.value != nil }) else { return }
        if let last = workspace.history.first, last.calculatorID == calc.id, last.inputs == inputs { return }
        let summary = "\(first.label): \(Format.value(first.value, first.format))"
        workspace.history.insert(HistoryItem(calculatorID: calc.id, inputs: inputs, summary: summary, date: Date()), at: 0)
        if workspace.history.count > Self.historyLimit { workspace.history.removeLast(workspace.history.count - Self.historyLimit) }
    }

    func clearHistory() { workspace.history.removeAll() }

    // MARK: Clipboard

    func copy(_ text: String, message: String = "Copied to clipboard.") {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        flash(message)
    }

    func flash(_ message: String) {
        toast = message
        toastWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.toast = nil }
        toastWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }

    // MARK: Persistence

    static var workspaceURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Wealth Desk", isDirectory: true).appendingPathComponent("workspace.json")
    }

    private func loadWorkspace() {
        let url = Self.workspaceURL
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        do {
            workspace = try Self.decoder.decode(Workspace.self, from: Data(contentsOf: url))
        } catch {
            // Keep the unreadable file; write future saves beside it.
            let backup = url.deletingPathExtension().appendingPathExtension("unreadable-\(Int(Date().timeIntervalSince1970)).json")
            try? FileManager.default.copyItem(at: url, to: backup)
            toast = "Saved work couldn't be read. The original was kept as \(backup.lastPathComponent)."
        }
    }

    private func scheduleSave() {
        saveWork?.cancel()
        let snapshot = workspace
        let work = DispatchWorkItem {
            let url = Self.workspaceURL
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if let data = try? Self.encoder.encode(snapshot) { try? data.write(to: url, options: .atomic) }
        }
        saveWork = work
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    // MARK: Export / import

    func exportWork() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.nameFieldStringValue = "Wealth Desk saved work.json"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try Self.encoder.encode(workspace).write(to: url, options: .atomic)
            flash("Exported saved work.")
        } catch {
            flash("Export failed: \(error.localizedDescription)")
        }
    }

    func importWork() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let incoming = try Self.decoder.decode(Workspace.self, from: Data(contentsOf: url))
            var w = workspace
            for f in incoming.favorites where !w.favorites.contains(f) { w.favorites.append(f) }
            for (k, v) in incoming.working where w.working[k] == nil { w.working[k] = v }
            let existing = Set(w.scenarios.map(\.id))
            w.scenarios += incoming.scenarios.filter { !existing.contains($0.id) }
            w.scenarios.sort { $0.created > $1.created }
            let seen = Set(w.history.map(\.id))
            w.history += incoming.history.filter { !seen.contains($0.id) }
            w.history.sort { $0.date > $1.date }
            workspace = w
            flash("Imported and merged saved work. Your settings were kept.")
        } catch {
            flash("Import failed: that file isn't Wealth Desk saved work.")
        }
    }
}
