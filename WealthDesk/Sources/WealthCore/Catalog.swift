import Foundation

public struct ChoiceOption: Codable, Hashable {
    public let value: Double
    public let label: String
}

public struct Field: Codable, Hashable, Identifiable {
    public let id: String
    public let label: String
    /// "$", "%", "years", "age", "series", "choice", "count", "x"
    public let unit: String
    public let example: String
    public let hint: String
    public let min: Double?
    public let max: Double?
    public let integer: Bool?
    public let options: [ChoiceOption]?
    /// Pre-filled technical setting (simulation count, seed). Never a dollar amount or market assumption.
    public let defaultValue: String?

    enum CodingKeys: String, CodingKey {
        case id, label, unit, example, hint, min, max, integer, options
        case defaultValue = "default"
    }

    public init(id: String, label: String, unit: String, example: String, hint: String,
                min: Double?, max: Double?, integer: Bool?, options: [ChoiceOption]?, defaultValue: String? = nil) {
        self.id = id; self.label = label; self.unit = unit; self.example = example; self.hint = hint
        self.min = min; self.max = max; self.integer = integer; self.options = options; self.defaultValue = defaultValue
    }

    /// What the field holds before the user types: blank, except pick-lists and technical settings.
    public var blankValue: String { defaultValue ?? (isChoice ? example : "") }

    public var isSeries: Bool { unit == "series" }
    public var isChoice: Bool { unit == "choice" }
    public var isPercent: Bool { unit == "%" }
}

public struct Output: Codable, Hashable, Identifiable {
    public let id: String
    public let label: String
    public let expression: String
    public let format: String
    public let excel: String?
    public let expected: Double?
}

public struct Rule: Codable, Hashable {
    public let left: String
    public let relation: String
    public let right: String
    public let message: String
}

public struct Source: Codable, Hashable {
    public let title: String
    public let url: String
}

public struct TableColumn: Codable, Hashable {
    public let label: String
    public let format: String
}

public struct TableSpec: Codable, Hashable {
    public let columns: [TableColumn]
    public let chartColumns: [Int]
}

public struct Calculator: Codable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let category: String
    public let fields: [Field]
    public let outputs: [Output]
    public let math: String
    public let summary: String
    public let aliases: String
    public let acronym: String
    public let assumptions: String
    public let interpretation: String
    public let excelNotes: String
    public let rules: [Rule]
    public let common: Bool
    public let sources: [Source]
    public let projection: String?
    public let table: TableSpec?

    public var exampleInputs: [String: String] {
        Dictionary(uniqueKeysWithValues: fields.map { ($0.id, $0.example) })
    }

    /// Clean starting state: no amounts or assumptions filled in.
    public var blankInputs: [String: String] {
        Dictionary(uniqueKeysWithValues: fields.map { ($0.id, $0.blankValue) })
    }

    /// True when any formula reads the dated IRS tax table.
    public var usesTaxTable: Bool {
        let names = ["incometax(", "margrate(", "bracketroom(", "stddeduction(", "ltcgtax(", "niitthreshold(",
                     "niitrate(", "rmdfactor(", "limit401k(", "limitira(", "giftexclusion(", "estateexemption(", "estaterate("]
        let text = (outputs.map(\.expression) + rules.map(\.left) + rules.map(\.right)).joined(separator: " ")
        return names.contains { text.contains($0) }
    }

    /// Lower-cased text used for search.
    public var searchText: String {
        [name, category, summary, aliases, acronym, math].joined(separator: " ").lowercased()
    }
}

public enum CatalogLoader {
    public static func load(from url: URL) throws -> [Calculator] {
        try JSONDecoder().decode([Calculator].self, from: Data(contentsOf: url))
    }

    /// Category order as it first appears in the catalog.
    public static func categories(_ calcs: [Calculator]) -> [String] {
        var seen: [String] = []
        for c in calcs where !seen.contains(c.category) { seen.append(c.category) }
        return seen
    }

    /// Simple ranked search: every query word must match; name and acronym hits rank higher.
    public static func search(_ query: String, in calcs: [Calculator]) -> [Calculator] {
        let words = query.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber && $0 != "%" }).map(String.init)
        guard !words.isEmpty else { return [] }
        var scored: [(Int, Calculator)] = []
        for c in calcs {
            let text = c.searchText
            guard words.allSatisfy({ text.contains($0) }) else { continue }
            let name = c.name.lowercased()
            var score = 0
            for w in words {
                if c.acronym.lowercased() == w { score += 50 }
                if name.hasPrefix(w) { score += 20 }
                if name.contains(w) { score += 10 }
                if c.aliases.lowercased().contains(w) { score += 3 }
            }
            if c.common { score += 2 }
            scored.append((score, c))
        }
        return scored.sorted { $0.0 > $1.0 }.map(\.1)
    }
}
