import Foundation

/// Detects when the IRS has published tax figures newer than the ones the app ships with.
/// Reads public IRS.gov pages (no account, no user data sent).
public enum IRSCheck {
    public static let pages: [URL] = [
        URL(string: "https://www.irs.gov/newsroom")!,
        URL(string: "https://www.irs.gov/newsroom/inflation-adjusted-tax-items-by-tax-year")!,
    ]

    public struct Published: Equatable, Codable {
        /// Newest year with an "inflation adjustments for tax year YYYY" release.
        public var taxYear: Int?
        /// Newest year with a "401(k) limit … for YYYY" release.
        public var limitsYear: Int?

        public init(taxYear: Int? = nil, limitsYear: Int? = nil) {
            self.taxYear = taxYear
            self.limitsYear = limitsYear
        }

        public func merged(with other: Published) -> Published {
            Published(taxYear: [taxYear, other.taxYear].compactMap { $0 }.max(),
                      limitsYear: [limitsYear, other.limitsYear].compactMap { $0 }.max())
        }
    }

    /// Strips tags and entities, then finds release titles that name a year.
    public static func parse(html: String) -> Published {
        var text = html.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        for (entity, char) in ["&amp;": "&", "&#039;": "'", "&nbsp;": " ", "&quot;": "\""] {
            text = text.replacingOccurrences(of: entity, with: char)
        }
        text = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        func maxYear(_ pattern: String) -> Int? {
            guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
            let ns = text as NSString
            return re.matches(in: text, range: NSRange(location: 0, length: ns.length))
                .compactMap { Int(ns.substring(with: $0.range(at: 1))) }
                .max()
        }
        return Published(
            taxYear: maxYear(#"inflation adjustments for tax year (20\d\d)"#),
            limitsYear: maxYear(#"401\(k\) (?:contribution )?limit[^.]{0,60}? for (20\d\d)"#)
        )
    }

    public enum Status: Equatable {
        case upToDate
        /// The IRS has published figures the app doesn't have.
        case newerTaxYear(published: Int, loaded: Int)
        case newerLimits(published: Int, loaded: Int)
    }

    /// Compares what the IRS has published with what the app has loaded.
    public static func compare(_ p: Published, data: TaxData) -> [Status] {
        var out: [Status] = []
        if let y = p.taxYear, y > data.latestYear {
            out.append(.newerTaxYear(published: y, loaded: data.latestYear))
        }
        let loadedLimits = data.tables.map(\.limitsYear).max() ?? 0
        if let y = p.limitsYear, y > loadedLimits {
            out.append(.newerLimits(published: y, loaded: loadedLimits))
        }
        return out.isEmpty ? [.upToDate] : out
    }

    public static func message(_ s: Status) -> String {
        switch s {
        case .upToDate:
            return "Tax figures match the newest IRS releases found on IRS.gov."
        case .newerTaxYear(let p, let l):
            return "The IRS has published \(p) tax figures; Wealth Desk has figures through \(l). Update taxdata.json."
        case .newerLimits(let p, let l):
            return "The IRS has published \(p) 401(k)/IRA limits; Wealth Desk uses \(l) limits. Update taxdata.json."
        }
    }
}
