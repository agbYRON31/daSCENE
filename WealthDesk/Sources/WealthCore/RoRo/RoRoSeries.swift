import Foundation

// Time-series primitives for the RoRo port. Each function reproduces the pandas
// operation named in its comment (NaN = missing), so the Swift engine matches the
// original Python engine number for number.

/// Days since 1970-01-01 (calendar date, no time zone).
public typealias Day = Int

public enum DayMath {
    static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    public static func day(_ y: Int, _ m: Int, _ d: Int) -> Day {
        let date = utc.date(from: DateComponents(year: y, month: m, day: d))!
        return Int(date.timeIntervalSince1970 / 86_400)
    }

    public static func date(_ d: Day) -> Date { Date(timeIntervalSince1970: Double(d) * 86_400) }

    public static func components(_ d: Day) -> (y: Int, m: Int, d: Int) {
        let c = utc.dateComponents([.year, .month, .day], from: date(d))
        return (c.year!, c.month!, c.day!)
    }

    /// "YYYY-MM-DD"
    public static func iso(_ d: Day) -> String {
        let c = components(d)
        return String(format: "%04d-%02d-%02d", c.y, c.m, c.d)
    }

    public static func parse(_ s: String) -> Day? {
        let p = s.prefix(10).split(separator: "-")
        guard p.count == 3, let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return nil }
        return day(y, m, d)
    }

    static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    /// strftime("%b %d, %Y")
    public static func long(_ d: Day) -> String {
        let c = components(d)
        return String(format: "%@ %02d, %04d", months[c.m - 1], c.d, c.y)
    }

    /// strftime("%b %Y")
    public static func monthYear(_ d: Day) -> String {
        let c = components(d)
        return "\(months[c.m - 1]) \(c.y)"
    }

    /// 1970-01-01 was a Thursday. Returns 0 = Monday … 6 = Sunday.
    public static func weekday(_ d: Day) -> Int { ((d % 7) + 7 + 3) % 7 }

    /// pd.bdate_range(start, end): every Monday–Friday (no holiday calendar).
    public static func businessDays(from start: Day, through end: Day) -> [Day] {
        guard end >= start else { return [] }
        return (start...end).filter { weekday($0) < 5 }
    }

    /// d − pd.DateOffset(months: n): same day number, clipped to the target month's end.
    public static func subtractMonths(_ d: Day, _ n: Int) -> Day {
        let c = components(d)
        var y = c.y, m = c.m - n
        while m < 1 { m += 12; y -= 1 }
        let first = day(y, m, 1)
        let nextFirst = m == 12 ? day(y + 1, 1, 1) : day(y, m + 1, 1)
        return first + min(c.d, nextFirst - first) - 1
    }
}

/// A dated series at its native frequency (sorted, one value per day).
public struct TimeSeries: Equatable {
    public var days: [Day]
    public var values: [Double]

    public init(days: [Day], values: [Double]) {
        // s[~s.index.duplicated(keep="last")] after sorting
        var pairs: [Day: Double] = [:]
        for (d, v) in zip(days, values) { pairs[d] = v }
        let sorted = pairs.keys.sorted()
        self.days = sorted
        self.values = sorted.map { pairs[$0]! }
    }

    public var isEmpty: Bool { days.isEmpty }
    public var lastDay: Day? { days.last }

    /// Applies a positional array transform at the native frequency.
    public func map(_ f: ([Double]) -> [Double]) -> TimeSeries {
        var t = self
        t.values = f(values)
        return t
    }

    public func dropNaN() -> TimeSeries {
        let keep = values.indices.filter { !values[$0].isNaN }
        return TimeSeries(days: keep.map { days[$0] }, values: keep.map { values[$0] })
    }
}

public enum Ops {
    /// s.reindex(index ∪ s.index).ffill(limit:).reindex(index)
    public static func align(_ s: TimeSeries?, to index: [Day], limit: Int? = nil) -> [Double]? {
        guard let s, !s.isEmpty else { return nil }
        var out = [Double](repeating: .nan, count: index.count)
        var j = 0
        var last = Double.nan
        var gap = 0
        // Walk the union of both indexes in date order.
        var i = 0
        while i < index.count || j < s.days.count {
            let nextIdx = i < index.count ? index[i] : Int.max
            let nextObs = j < s.days.count ? s.days[j] : Int.max
            let d = min(nextIdx, nextObs)
            var v = Double.nan
            if nextObs == d { v = s.values[j]; j += 1 }
            if !v.isNaN {
                last = v; gap = 0
            } else if !last.isNaN {
                gap += 1
                if let limit, gap > limit { v = .nan } else { v = last }
            }
            if nextIdx == d { out[i] = v; i += 1 }
        }
        return out
    }

    /// s.pct_change(n, fill_method=None)
    public static func pctChange(_ a: [Double], _ n: Int) -> [Double] {
        a.indices.map { $0 >= n ? a[$0] / a[$0 - n] - 1 : .nan }
    }

    /// s.shift(n) for n ≥ 0
    public static func shift(_ a: [Double], _ n: Int) -> [Double] {
        a.indices.map { $0 >= n ? a[$0 - n] : .nan }
    }

    /// s.shift(-n) for n ≥ 0
    public static func lead(_ a: [Double], _ n: Int) -> [Double] {
        a.indices.map { $0 + n < a.count ? a[$0 + n] : .nan }
    }

    static func rolling(_ a: [Double], _ w: Int, _ minp: Int, _ f: (ArraySlice<Double>) -> Double) -> [Double] {
        a.indices.map { i in
            let win = a[max(0, i - w + 1)...i]
            let n = win.reduce(0) { $0 + ($1.isNaN ? 0 : 1) }
            return n >= minp ? f(win) : .nan
        }
    }

    /// s.rolling(w, min_periods=minp).mean()
    public static func rollingMean(_ a: [Double], _ w: Int, minp: Int? = nil) -> [Double] {
        // Running sums keep this O(n) for 7,000-point series.
        let minp = minp ?? w
        var out = [Double](repeating: .nan, count: a.count)
        var sum = 0.0, count = 0
        for i in a.indices {
            if !a[i].isNaN { sum += a[i]; count += 1 }
            if i >= w, !a[i - w].isNaN { sum -= a[i - w]; count -= 1 }
            if count >= minp && count > 0 { out[i] = sum / Double(count) }
        }
        return out
    }

    /// s.rolling(w, min_periods=minp).max()
    public static func rollingMax(_ a: [Double], _ w: Int, minp: Int) -> [Double] {
        rolling(a, w, minp) { $0.filter { !$0.isNaN }.max() ?? .nan }
    }

    /// s.rolling(w, min_periods=minp).min()
    public static func rollingMin(_ a: [Double], _ w: Int, minp: Int) -> [Double] {
        rolling(a, w, minp) { $0.filter { !$0.isNaN }.min() ?? .nan }
    }

    /// s.ewm(span=span, min_periods=1).mean()  (adjust=True, ignore_na=False)
    public static func ewm(_ a: [Double], span: Double) -> [Double] {
        guard !a.isEmpty else { return [] }
        let alpha = 2.0 / (span + 1.0)
        let oldFactor = 1.0 - alpha
        let newWt = 1.0
        var weighted = a[0]
        var nobs = weighted.isNaN ? 0 : 1
        var oldWt = 1.0
        var out = [Double](repeating: .nan, count: a.count)
        out[0] = nobs >= 1 ? weighted : .nan
        for i in 1..<a.count {
            let cur = a[i]
            let isObs = !cur.isNaN
            if isObs { nobs += 1 }
            if !weighted.isNaN {
                oldWt *= oldFactor
                if isObs {
                    if weighted != cur {
                        weighted = (oldWt * weighted + newWt * cur) / (oldWt + newWt)
                    }
                    oldWt += newWt
                }
            } else if isObs {
                weighted = cur
            }
            out[i] = nobs >= 1 ? weighted : .nan
        }
        return out
    }

    public static func zipWith(_ a: [Double], _ b: [Double], _ f: (Double, Double) -> Double) -> [Double] {
        zip(a, b).map(f)
    }

    /// np.interp(x, xs, ys) with clamping; NaN stays NaN.
    public static func interp(_ x: Double, _ pts: [(Double, Double)]) -> Double {
        if x.isNaN { return .nan }
        if x <= pts[0].0 { return pts[0].1 }
        if x >= pts[pts.count - 1].0 { return pts[pts.count - 1].1 }
        for k in 1..<pts.count where x <= pts[k].0 {
            let (x0, y0) = pts[k - 1], (x1, y1) = pts[k]
            // numpy: slope * (x - x0) + y0
            return (y1 - y0) / (x1 - x0) * (x - x0) + y0
        }
        return pts[pts.count - 1].1
    }

    /// Row-wise weighted average ignoring NaN cells (engine.wavg).
    public static func weightedAverage(_ columns: [(weight: Double, values: [Double])], count: Int) -> [Double] {
        (0..<count).map { i in
            var num = 0.0, den = 0.0
            for c in columns where !c.values[i].isNaN {
                num += c.values[i] * c.weight
                den += c.weight
            }
            return den > 0 ? num / den : .nan
        }
    }

    public static func mean(_ a: [Double]) -> Double {
        let v = a.filter { !$0.isNaN }
        return v.isEmpty ? .nan : v.reduce(0, +) / Double(v.count)
    }

    /// pandas Series.std() (ddof = 1, NaN skipped)
    public static func std(_ a: [Double]) -> Double {
        let v = a.filter { !$0.isNaN }
        guard v.count > 1 else { return .nan }
        let m = v.reduce(0, +) / Double(v.count)
        return (v.reduce(0) { $0 + ($1 - m) * ($1 - m) } / Double(v.count - 1)).squareRoot()
    }

    /// Python round(x, d): correctly rounded, ties to even.
    public static func pyRound(_ x: Double, _ d: Int) -> Double {
        guard x.isFinite else { return x }
        return Double(String(format: "%.\(d)f", x)) ?? x
    }

    /// Python format(x, spec) for the "{:+.Nf}"-style specs RoRo uses.
    public static func fmt(_ x: Double, decimals: Int, sign: Bool = false) -> String {
        String(format: sign ? "%+.\(decimals)f" : "%.\(decimals)f", x)
    }
}
