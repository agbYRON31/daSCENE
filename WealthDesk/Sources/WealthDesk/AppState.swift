import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers
import WealthCore

// MARK: - What is kept, and where
//
// Preferences  → saved on this Mac (favorites, watchlist tickers, tax year, window settings).
//                Never contains amounts or assumptions typed into a calculator.
// Session      → memory only. Calculator inputs, results history, the calculator tape and
//                session scenarios live here and are gone when the app quits or the session is cleared.
// Scenario files and PDF reports are written only when the user explicitly chooses to, to a
// location they pick.

struct Preferences: Codable {
    var version = 2
    var favorites: [String] = []
    var pinned = false
    var watchlist: [String] = ["SPY", "VTI", "BND", "AGG"]
    /// Tax year chosen by the user; nil follows the calendar year.
    var taxYear: Int? = nil
    var checkIRS = true
    var irsCheckedAt: Date? = nil
    var irsPublished: IRSCheck.Published? = nil
    var calcDegrees = true
    var calcScientific = false

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Preferences()
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? d.version
        favorites = try c.decodeIfPresent([String].self, forKey: .favorites) ?? d.favorites
        pinned = try c.decodeIfPresent(Bool.self, forKey: .pinned) ?? d.pinned
        watchlist = try c.decodeIfPresent([String].self, forKey: .watchlist) ?? d.watchlist
        taxYear = try c.decodeIfPresent(Int.self, forKey: .taxYear)
        checkIRS = try c.decodeIfPresent(Bool.self, forKey: .checkIRS) ?? d.checkIRS
        irsCheckedAt = try c.decodeIfPresent(Date.self, forKey: .irsCheckedAt)
        irsPublished = try c.decodeIfPresent(IRSCheck.Published.self, forKey: .irsPublished)
        calcDegrees = try c.decodeIfPresent(Bool.self, forKey: .calcDegrees) ?? d.calcDegrees
        calcScientific = try c.decodeIfPresent(Bool.self, forKey: .calcScientific) ?? d.calcScientific
    }
}

struct SessionScenario: Identifiable, Hashable {
    var id = UUID()
    var name: String
    var calculatorID: String
    var inputs: [String: String]
    var created = Date()
}

struct HistoryItem: Identifiable, Hashable {
    var id = UUID()
    var calculatorID: String
    var inputs: [String: String]
    var summary: String
    var date = Date()
}

struct TapeEntry: Identifiable, Hashable {
    var id = UUID()
    var expression: String
    var result: Double
    var assigned: String?
    var date = Date()
}

/// Everything typed during this run of the app. Never written to disk automatically.
struct Session {
    var working: [String: [String: String]] = [:]
    var scenarios: [SessionScenario] = []
    var history: [HistoryItem] = []
    var tape: [TapeEntry] = []
    var variables: [String: Double] = [:]

    var isEmpty: Bool { working.isEmpty && scenarios.isEmpty && history.isEmpty && tape.isEmpty && variables.isEmpty }
}

enum Screen: Hashable { case start, advisor, client }

enum SidebarItem: Hashable {
    case home
    case calc(String)
    case calculator
    case markets
    case roro
    case scenarios
    case history
}

enum ClientTool: String, CaseIterable, Identifiable {
    case growth, retirement, risk, decisions, taxes
    var id: String { rawValue }
}

@MainActor
final class AppState: ObservableObject {
    let engine: Engine?
    let loadError: String?
    @Published var prefs = Preferences() { didSet { scheduleSave() } }
    @Published var session = Session()
    @Published var screen: Screen = .start
    @Published var selection: SidebarItem? = .home
    @Published var clientTool: ClientTool? = nil
    @Published var search = ""
    @Published var toast: String?
    @Published var irsChecking = false
    @Published var irsError: String?

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
        loadPreferences()
        if let y = prefs.taxYear, engine?.selectTaxYear(y) != true { prefs.taxYear = nil }
        if prefs.checkIRS { Task { await checkIRS(force: false) } }
    }

    // MARK: Modes & navigation

    func enter(_ mode: Screen) {
        screen = mode
        if mode == .advisor, selection == nil { selection = .home }
    }

    /// Opens a calculator in Advisor Mode (from Client Mode, RoRo, Markets or the home page).
    func showInAdvisor(_ id: String) {
        guard let calc = calculator(id) else { return }
        screen = .advisor
        selection = .calc(calc.id)
    }

    func showClient(_ tool: ClientTool?) {
        screen = .client
        clientTool = tool
    }

    // MARK: Tax year & IRS check

    var taxYears: [Int] { engine?.taxData?.years ?? [] }
    var taxTable: TaxTable? { engine?.tax }

    func setTaxYear(_ year: Int) {
        guard engine?.selectTaxYear(year) == true else { return }
        let def = engine?.taxData?.defaultYear()
        prefs.taxYear = (year == def) ? nil : year
    }

    /// Warnings from the latest IRS.gov check (empty when up to date or not yet checked).
    var irsWarnings: [String] {
        guard let pub = prefs.irsPublished, let data = engine?.taxData else { return [] }
        return IRSCheck.compare(pub, data: data).filter { $0 != .upToDate }.map(IRSCheck.message)
    }

    /// Reads public IRS.gov release pages (at most once a day unless forced) to see whether newer
    /// tax figures exist than the ones shipped in taxdata.json. Sends nothing the user typed.
    func checkIRS(force: Bool) async {
        if !force, let last = prefs.irsCheckedAt, Date().timeIntervalSince(last) < 86_400 { return }
        guard !irsChecking else { return }
        irsChecking = true
        defer { irsChecking = false }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.httpAdditionalHeaders = ["User-Agent": "Mozilla/5.0 (Macintosh) WealthDesk"]
        let urlSession = URLSession(configuration: config)
        var found = IRSCheck.Published()
        var reached = 0
        for url in IRSCheck.pages {
            if let (data, resp) = try? await urlSession.data(from: url), (resp as? HTTPURLResponse)?.statusCode == 200 {
                reached += 1
                found = found.merged(with: IRSCheck.parse(html: String(decoding: data, as: UTF8.self)))
            }
        }
        guard reached > 0 else {
            irsError = "Couldn't reach IRS.gov to check for newer tax figures."
            return
        }
        irsError = nil
        prefs.irsPublished = found
        prefs.irsCheckedAt = Date()
        let warnings = irsWarnings
        if !warnings.isEmpty { flash(warnings[0]) }
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

    // MARK: Inputs (session only)

    /// Calculators start blank: no amounts or assumptions are pre-filled.
    func inputs(for calc: Calculator) -> [String: String] {
        session.working[calc.id] ?? calc.blankInputs
    }

    func setInput(_ calc: Calculator, _ field: String, _ value: String) {
        var current = inputs(for: calc)
        current[field] = value
        session.working[calc.id] = current
    }

    func setInputs(_ calc: Calculator, _ values: [String: String]) {
        var current = inputs(for: calc)
        for (k, v) in values where calc.fields.contains(where: { $0.id == k }) { current[k] = v }
        session.working[calc.id] = current
    }

    /// Fills illustrative numbers. Only ever done when the user asks.
    func fillSampleNumbers(_ calc: Calculator) {
        session.working[calc.id] = calc.exampleInputs
    }

    func clearInputs(_ calc: Calculator) {
        session.working[calc.id] = calc.blankInputs
    }

    /// Opens a calculator with some inputs replaced (e.g. a published yield or quoted price).
    func openCalculator(_ id: String, setting values: [String: String]) {
        guard let calc = calculator(id) else { return }
        setInputs(calc, values)
        showInAdvisor(id)
    }

    func select(_ calc: Calculator) { showInAdvisor(calc.id) }

    /// Forgets everything typed this session.
    func clearSession() {
        session = Session()
        flash("Session cleared. Nothing typed this session remains.")
    }

    // MARK: Favorites, session scenarios, history

    func isFavorite(_ id: String) -> Bool { prefs.favorites.contains(id) }

    func toggleFavorite(_ id: String) {
        if let i = prefs.favorites.firstIndex(of: id) { prefs.favorites.remove(at: i) } else { prefs.favorites.append(id) }
    }

    /// Keeps a snapshot for the rest of this session (memory only).
    func snapshotScenario(_ calc: Calculator, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        session.scenarios.insert(SessionScenario(name: trimmed.isEmpty ? calc.name : trimmed, calculatorID: calc.id,
                                                 inputs: inputs(for: calc)), at: 0)
        flash("Kept for this session. It is not saved to disk.")
    }

    func open(_ scenario: SessionScenario) {
        session.working[scenario.calculatorID] = scenario.inputs
        showInAdvisor(scenario.calculatorID)
    }

    func deleteScenario(_ s: SessionScenario) { session.scenarios.removeAll { $0.id == s.id } }

    func open(_ item: HistoryItem) {
        session.working[item.calculatorID] = item.inputs
        showInAdvisor(item.calculatorID)
    }

    func recordHistory(_ calc: Calculator, inputs: [String: String], evaluation: Evaluation) {
        guard evaluation.isComplete, let first = evaluation.outputs.first(where: { $0.value != nil }) else { return }
        if let last = session.history.first, last.calculatorID == calc.id, last.inputs == inputs { return }
        let summary = "\(first.label): \(Format.value(first.value, first.format))"
        session.history.insert(HistoryItem(calculatorID: calc.id, inputs: inputs, summary: summary), at: 0)
        if session.history.count > Self.historyLimit { session.history.removeLast(session.history.count - Self.historyLimit) }
    }

    func clearHistory() { session.history.removeAll() }

    // MARK: Scenario files (explicit, local, optional password)

    static let scenarioType = UTType(filenameExtension: "wealthdesk") ?? .json

    /// Writes one calculator's inputs to a file the user chooses. Returns false if cancelled.
    @discardableResult
    func saveScenarioFile(calculatorID: String, title: String, inputs: [String: String], password: String?) -> Bool {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [Self.scenarioType]
        panel.nameFieldStringValue = "\(title).wealthdesk"
        panel.message = "Saved only to the location you choose on this Mac. Wealth Desk does not upload or sync it."
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        do {
            let file = ScenarioFile(calculatorID: calculatorID, title: title, inputs: inputs)
            try file.data(password: password).write(to: url, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            flash(password?.isEmpty == false ? "Saved (password-protected)." : "Saved to the file you chose.")
            return true
        } catch {
            flash("Couldn't save: \(error.localizedDescription)")
            return false
        }
    }

    /// Opens a scenario file into this session. Asks for the password when the file is protected.
    func openScenarioFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [Self.scenarioType, .json]
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url) else { return }
        var password: String? = nil
        if ScenarioFile.isEncrypted(data) {
            let alert = NSAlert()
            alert.messageText = "This scenario is password-protected"
            alert.informativeText = "Enter the password used when it was saved."
            let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
            alert.accessoryView = field
            alert.addButton(withTitle: "Open")
            alert.addButton(withTitle: "Cancel")
            alert.window.initialFirstResponder = field
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            password = field.stringValue
        }
        do {
            let file = try ScenarioFile.read(data, password: password)
            guard let calc = calculator(file.calculatorID) else {
                flash("That scenario is for a calculator this version doesn't have.")
                return
            }
            var inputs = calc.blankInputs
            for (k, v) in file.inputs where inputs[k] != nil { inputs[k] = v }
            session.working[calc.id] = inputs
            session.scenarios.insert(SessionScenario(name: file.title, calculatorID: calc.id, inputs: inputs), at: 0)
            showInAdvisor(calc.id)
            flash("Opened “\(file.title)” into this session.")
        } catch {
            flash(error.localizedDescription)
        }
    }

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
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5, execute: work)
    }

    // MARK: Preferences persistence (no financial inputs)

    nonisolated static var supportFolder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Wealth Desk", isDirectory: true)
    }

    nonisolated static var preferencesURL: URL { supportFolder.appendingPathComponent("preferences.json") }

    private func loadPreferences() {
        guard let data = try? Data(contentsOf: Self.preferencesURL),
              let p = try? Self.decoder.decode(Preferences.self, from: data) else { return }
        prefs = p
    }

    private func scheduleSave() {
        saveWork?.cancel()
        let snapshot = prefs
        let work = DispatchWorkItem {
            let url = Self.preferencesURL
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
}
