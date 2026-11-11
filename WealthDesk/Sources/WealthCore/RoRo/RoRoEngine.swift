import Foundation

/// Port of roro/engine.py: factors → buckets → horizon composites, plus every dashboard panel.
/// Output is the same JSON model the dashboard template renders.
public enum RoRoEngine {
    typealias C = RoRoConfig
    static var BK: [String] { C.bucketKeys }
    static let HZ = C.horizons

    public struct LastRun {
        public let date: String
        public let intermediate: Double
        public init(date: String, intermediate: Double) { self.date = date; self.intermediate = intermediate }
    }

    // MARK: Primitives

    static func band(_ v: Double?) -> String? {
        guard let v, !v.isNaN else { return nil }
        return v > C.offenseLine ? "OFFENSE" : (v < C.defenseLine ? "DEFENSE" : "NEUTRAL")
    }

    static func regime(_ v: Double) -> String {
        if v >= 60 { return "Risk-On Aggressive" }
        if v >= 20 { return "Risk-On Constructive" }
        if v > -20 { return "Neutral" }
        if v > -60 { return "Risk-Off Defensive" }
        return "Crisis"
    }

    static func sig(_ s: Double) -> String {
        if s.isNaN { return "N/A" }
        return s >= C.signalOn ? "ON" : (s <= C.signalOff ? "OFF" : "NEU")
    }

    static func trailingTrue(_ c: [Bool]) -> Int {
        var n = 0
        for v in c.reversed() { if !v { break }; n += 1 }
        return n
    }

    static func last(_ a: [Double]) -> Double { a.last ?? .nan }

    /// a.iloc[-k] (k ≥ 1)
    static func back(_ a: [Double], _ k: Int) -> Double { a.count >= k ? a[a.count - k] : .nan }

    /// a.iloc[-n::step]
    static func tailStep(_ a: [Double], _ n: Int, _ step: Int) -> [Double] {
        stride(from: max(0, a.count - n), to: a.count, by: step).map { a[$0] }
    }

    static func f0(_ x: Double, sign: Bool = false) -> String { Ops.fmt(x, decimals: 0, sign: sign) }

    // MARK: Core model

    struct Core {
        var index: [Day]
        var raw: [String: [Double]]          // nil factors omitted
        var S: [(String, [Double])]          // factor scores, factor order
        var B: [(String, [Double])]          // bucket scores, bucket order
        var comp: [String: [Double]]
        var compRaw: [String: [Double]]

        func score(_ id: String) -> [Double]? { S.first { $0.0 == id }?.1 }
        func bucket(_ k: String) -> [Double]? { B.first { $0.0 == k }?.1 }
        var n: Int { index.count }

        func bucketRow(_ i: Int) -> [(String, Double)] { B.map { ($0.0, $0.1[i]) } }
    }

    static func computeCore(_ D: RoRoData) -> Core {
        var raw: [String: [Double]] = [:]
        var S: [(String, [Double])] = []
        for f in C.factors {
            guard var s = f.calc(D), s.contains(where: { !$0.isNaN }) else { continue }
            s = s.map { $0.isInfinite ? .nan : $0 }
            raw[f.id] = s
            S.append((f.id, s.map { Ops.interp($0, f.map) }))
        }
        var B: [(String, [Double])] = []
        for b in BK {
            let cols = S.filter { id, _ in C.factor(id)!.bucket == b }
            if !cols.isEmpty {
                B.append((b, Ops.weightedAverage(cols.map { (C.factor($0.0)!.weight, $0.1) }, count: D.count)))
            }
        }
        var comp: [String: [Double]] = [:], compRaw: [String: [Double]] = [:]
        for h in HZ {
            let w = C.horizonWeights[h]!
            var c = Ops.weightedAverage(B.map { (w[$0.0] ?? 0, $0.1) }, count: D.count)
            for i in c.indices where B.filter({ !$0.1[i].isNaN }).count < 4 { c[i] = .nan }
            compRaw[h] = c
            let span = C.horizonSmoothing[h]!
            if span > 1 {
                let e = Ops.ewm(c, span: span)
                comp[h] = zip(e, c).map { $1.isNaN ? .nan : $0 }
            } else {
                comp[h] = c
            }
        }
        return Core(index: D.index, raw: raw, S: S, B: B, comp: comp, compRaw: compRaw)
    }

    static func trim(_ core: Core, to n: Int) -> Core {
        var c = core
        c.index = Array(core.index.prefix(n))
        c.raw = core.raw.mapValues { Array($0.prefix(n)) }
        c.S = core.S.map { ($0.0, Array($0.1.prefix(n))) }
        c.B = core.B.map { ($0.0, Array($0.1.prefix(n))) }
        c.comp = core.comp.mapValues { Array($0.prefix(n)) }
        c.compRaw = core.compRaw.mapValues { Array($0.prefix(n)) }
        return c
    }

    /// Bucket + horizon composites for one day's factor scores (used by scenarios).
    static func compositesFromScores(_ row: [String: Double]) -> ([String: Double], [String: Double]) {
        var bk: [String: Double] = [:]
        for b in BK {
            let items = C.factors.filter { $0.bucket == b }.compactMap { f -> (Double, Double)? in
                guard let s = row[f.id], !s.isNaN else { return nil }
                return (f.weight, s)
            }
            if !items.isEmpty {
                bk[b] = items.reduce(0) { $0 + $1.0 * $1.1 } / items.reduce(0) { $0 + $1.0 }
            }
        }
        var hz: [String: Double] = [:]
        for h in HZ {
            let w = C.horizonWeights[h]!
            // Python iterates bk in insertion (bucket) order.
            let present = BK.filter { bk[$0] != nil }
            let den = present.reduce(0) { $0 + w[$1]! }
            hz[h] = den != 0 ? present.reduce(0) { $0 + w[$1]! * bk[$1]! } / den : .nan
        }
        return (bk, hz)
    }

    // MARK: Panels

    static let plain: [(Double, String)] = [
        (40, "Conditions are clearly supportive. Lean into risk."),
        (20, "Constructive backdrop. Modest overweight is reasonable."),
        (5, "Mixed and slightly positive. Stay benchmark-weight."),
        (-5, "Balanced — no edge either way. Stay benchmark-weight."),
        (-20, "Mixed and slightly negative. Stay benchmark-weight, tighten risk."),
        (-60, "Deteriorating. Reduce risk and favour defensives."),
        (-999, "Crisis conditions — historically a contrarian zone, but protect capital first."),
    ]

    static func plainEnglish(_ v: Double) -> String {
        for (th, txt) in plain where v >= th { return txt }
        return plain.last!.1
    }

    static func horizonPanel(_ c: Core, _ h: String) -> JSONValue {
        let s = c.comp[h]!.filter { !$0.isNaN }
        let v = last(s)
        let w = C.horizonWeights[h]!
        let cur = c.bucketRow(c.n - 1).filter { !$0.1.isNaN }
        let contrib = cur.map { ($0.0, w[$0.0]! * $0.1 / 100) }
        var top: (String, Double)? = nil, low: (String, Double)? = nil
        for x in contrib {
            if top == nil || x.1 > top!.1 { top = x }
            if low == nil || x.1 < low!.1 { low = x }
        }
        func pick(_ p: (String, Double)?) -> JSONValue {
            guard let p else { return .null }
            let score = cur.first { $0.0 == p.0 }!.1
            return .object([("bucket", .string(C.bucketName(p.0))), ("score", .r(score, 0))])
        }
        let meta = C.horizonMeta[h]!
        return .object([
            ("key", .string(h)), ("label", .string(meta.label)), ("span", .string(meta.span)), ("desc", .string(meta.desc)),
            ("value", .r(v, 0)),
            ("wow", s.count > 6 ? .r(v - back(s, 6), 0) : .null),
            ("avg4w", .r(Ops.mean(Array(s.suffix(20))), 0)),
            ("band", .str(band(v))), ("regime", .string(regime(v))), ("plain", .string(plainEnglish(v))),
            ("top", pick(top)), ("low", pick(low)),
            ("weights", .object(BK.map { ($0, .number(w[$0]!)) })),
        ])
    }

    static func bucketsPanel(_ c: Core) -> JSONValue {
        let n = c.n
        let wk = n > 6 ? n - 6 : n - 1
        return .array(BK.map { b in
            let col = c.bucket(b)
            let nLive = C.factors.filter { $0.bucket == b }.filter { f in c.score(f.id).map { !last($0).isNaN } ?? false }.count
            let nAll = C.factors.filter { $0.bucket == b }.count
            return .object([
                ("key", .string(b)), ("name", .string(C.bucketName(b))),
                ("score", .r(col.map { $0[n - 1] }, 0)),
                ("wow", col.map { .r($0[n - 1] - $0[wk], 0) } ?? .null),
                ("factors_live", .int(nLive)), ("factors_total", .int(nAll)),
                ("spark", .array(col.map { tailStep($0, 260, 5).map { .r($0, 0) } } ?? [])),
            ])
        })
    }

    static func factorTable(_ c: Core) -> JSONValue {
        var rows: [JSONValue] = []
        for b in BK {
            let fs = C.factors.filter { $0.bucket == b }
            let live = Set(fs.filter { f in c.score(f.id).map { !last($0).isNaN } ?? false }.map(\.id))
            var wsum = fs.filter { live.contains($0.id) }.reduce(0) { $0 + $1.weight }
            if wsum == 0 { wsum = 1 }
            for f in fs {
                let s = c.raw[f.id]
                let val = s.map(last) ?? .nan
                let scores = c.score(f.id)
                let sc = scores.map(last) ?? .nan
                let wt = live.contains(f.id) ? f.weight / wsum * 100 : 0
                let spark: [JSONValue] = s.map { tailStep($0, 252, 5).map { .r($0 * f.scale, 3) } } ?? []
                rows.append(.object([
                    ("id", .string(f.id)), ("name", .string(f.name)), ("bucket", .string(b)),
                    ("reading", .string(f.format(val))),
                    ("score", .r(sc, 0)), ("weight", .r(wt, 0)),
                    ("contrib", .r(sc.isNaN ? .nan : wt * sc / 100, 1)),
                    ("signal", .string(sig(sc))), ("src", .string(f.src)), ("spark", .array(spark)),
                    ("wow", scores != nil && c.n > 6 ? .r(sc - back(scores!, 6), 0) : .null),
                ]))
            }
        }
        return .array(rows)
    }

    static func flagsPanel(_ c: Core) -> JSONValue {
        var flags: [(kind: String, title: String, text: String, sessions: Int)] = []
        func add(_ kind: String, _ title: String, _ cond: [Bool]?, _ text: @autoclosure () -> String) {
            guard let cond, !cond.isEmpty else { return }
            let n = trailingTrue(cond)
            if n > 0 { flags.append((kind, title, text(), n)) }
        }
        let g = { (k: String) in c.raw[k] }
        let tac = c.comp["tactical"]!, str = c.comp["strategic"]!
        let t = last(tac), st = last(str)
        add("WARN", "Cross-horizon divergence", zip(tac, str).map { abs($0 - $1) > 30 },
            "Tactical (\(f0(t, sign: true))) vs Strategic (\(f0(st, sign: true))): a \(f0(abs(t - st)))-pt spread, past the 30-pt threshold. "
            + "Fast and slow signals disagree; these usually resolve by the fast dial reverting toward the slow one.")
        let disp: [Bool] = (0..<c.n).map { i in
            let row = c.B.map { $0.1[i] }.filter { !$0.isNaN }
            guard let mx = row.max(), let mn = row.min() else { return false }
            return mx - mn > 80
        }
        let lastRow = c.bucketRow(c.n - 1).filter { !$0.1.isNaN }
        if let hi = lastRow.max(by: { $0.1 < $1.1 }).map({ x in lastRow.first { $0.1 == x.1 }! }),
           let lo = lastRow.min(by: { $0.1 < $1.1 }).map({ x in lastRow.first { $0.1 == x.1 }! }) {
            add("WARN", "Bucket disagreement", disp,
                "\(C.bucketName(hi.0)) (\(f0(hi.1, sign: true))) vs \(C.bucketName(lo.0)) (\(f0(lo.1, sign: true))). "
                + "When buckets this far apart, the composite is an average of opposing calls — size positions down.")
        }
        if let cr = c.bucket("CREDIT"), let ma = c.bucket("MACRO") {
            add("OPP", "Credit not pricing macro risk", zip(cr, ma).map { $0 > 30 && $1 < -10 },
                "Credit bucket \(f0(last(cr), sign: true)) while Macro is \(f0(last(ma), sign: true)). "
                + "Either credit is right (no recession) or this is pre-stress complacency. Watch HY OAS for the first widening.")
        }
        if let dd = g("dd52"), let sb = g("sectbreadth") {
            add("WARN", "Narrow leadership", zip(dd, sb).map { $0 > -3 && $1 < 50 },
                "SPX within 3% of its 52-week high but only \(f0(last(sb)))% of sector ETFs are above their 200-DMA.")
        }
        if let vix = g("vix"), let skew = g("skew") {
            add("WARN", "Vol complacency", zip(vix, skew).map { $0 < 14 && $1 > 145 },
                "VIX \(Ops.fmt(last(vix), decimals: 1)) with SKEW \(f0(last(skew))): calm surface, tail hedges bid.")
        }
        if let vix = g("vix") {
            add("OPP", "VIX in add-to-risk zone", vix.map { $0 > 27.3 },
                "VIX \(Ops.fmt(last(vix), decimals: 1)) is above its long-run mean + 1σ. See the playbook for historical forward returns.")
        }
        if let d = g("dgs10chg") {
            add("RISK", "Rates shock", d.map { $0 > 0.6 },
                "10y yield up \(Ops.fmt(last(d), decimals: 2, sign: true)) pp over 3 months — fast enough to pressure multiples.")
        }
        if let nl = g("netliq") {
            add("RISK", "Liquidity drain", nl.map { $0 < -3 },
                "Net Fed liquidity down \(Ops.fmt(last(nl), decimals: 1))% over 13 weeks.")
        }
        if let s = g("sahm") {
            add("RISK", "Sahm Rule rising", s.map { $0 >= 0.3 },
                "Real-time Sahm reading \(Ops.fmt(last(s), decimals: 2)); the recession trigger is 0.50.")
        }
        if let cv = g("t10y3m") {
            let neg = cv.map { $0 < 0 ? 1.0 : 0.0 }
            let wasInv = Ops.rollingMax(neg, 504, minp: 1).map { $0 != 0 && !$0.isNaN }
            let minRecent = Ops.rollingMin(cv, 126, minp: 1)
            add("RISK", "Yield curve un-inverting", cv.indices.map { cv[$0] > 0 && wasInv[$0] && minRecent[$0] < 0 },
                "3m10y back to \(Ops.fmt(last(cv), decimals: 2, sign: true))% after an inversion. Historically the un-inversion, not the inversion, sat closest to recessions.")
        }
        if let s = g("spx50") {
            add("WARN", "Short-term momentum break", s.map { $0 < -5 },
                "SPX \(Ops.fmt(last(s), decimals: 1, sign: true))% below its 50-DMA.")
        }
        if let h = g("hychg") {
            add("RISK", "Credit spreads widening", h.map { $0 > 0.75 },
                "HY OAS up \(f0(last(h) * 100, sign: true)) bp in 3 months.")
        }
        let order = ["RISK": 0, "WARN": 1, "OPP": 2]
        let sorted = flags.enumerated().sorted { a, b in
            let ka = (order[a.element.kind]!, -a.element.sessions), kb = (order[b.element.kind]!, -b.element.sessions)
            return ka != kb ? ka < kb : a.offset < b.offset
        }.map(\.element)
        return .array(sorted.map { f in
            .object([("kind", .string(f.kind)), ("title", .string(f.title)), ("text", .string(f.text)), ("sessions", .int(f.sessions))])
        })
    }

    static func vixPanel(_ D: RoRoData) -> JSONValue {
        guard let vix = D.yfRaw("^VIX"), let spx = D.yfRaw("^GSPC") else { return .null }
        let m = Ops.mean(vix.values), sd = Ops.std(vix.values)
        let fwdVals = Ops.lead(spx.values, 252).enumerated().map { ($1 / spx.values[$0] - 1) * 100 }
        var fwd: [Day: Double] = [:]
        for (d, f) in zip(spx.days, fwdVals) where !f.isNaN { fwd[d] = f }
        // pd.concat([vix, fwd], axis=1).dropna(): dates with both values, in date order
        let df: [(v: Double, f: Double)] = zip(vix.days, vix.values).compactMap { d, v in
            guard !v.isNaN, let f = fwd[d] else { return nil }
            return (v, f)
        }
        let names = ["1ST", "2ND", "3RD", ">4σ"]
        var levels: [JSONValue] = []
        for k in 0..<4 {
            let lo = m + Double(k + 1) * sd
            let hi = k < 3 ? m + Double(k + 2) * sd : 1e9
            let sel = df.filter { $0.v >= lo && $0.v < hi }
            let enough = sel.count >= 10
            levels.append(.object([
                ("name", .string(names[k])), ("lo", .r(lo)), ("hi", k < 3 ? .r(hi) : .null),
                ("ret", enough ? .r(Ops.mean(sel.map(\.f))) : .null),
                ("win", enough ? .r(Double(sel.filter { $0.f > 0 }.count) / Double(sel.count) * 100, 0) : .null),
                ("n", .int(sel.count)),
            ]))
        }
        let base = df.filter { $0.v < m + sd }
        let cur = last(vix.values)
        let term: JSONValue = D.yfRaw("^VIX3M").map { .r(cur / last($0.values), 2) } ?? .null
        let zone = cur < m ? "BELOW MEAN · CALM" : (cur < m + sd ? "ABOVE MEAN · WATCHING" : "ADD-TO-RISK ZONE")
        let baseRet: Double = Ops.mean(base.map(\.f))
        let baseWin: Double = base.isEmpty ? .nan : Double(base.filter { $0.f > 0 }.count) / Double(base.count) * 100
        let baseJSON: JSONValue = .object([("ret", .r(baseRet)), ("win", .r(baseWin, 0))])
        let skew: JSONValue = D.yfRaw("^SKEW").map { .r(last($0.values), 0) } ?? .null
        let move: JSONValue = D.yfRaw("^MOVE").map { .r(last($0.values), 0) } ?? .null
        let tickValues: [Double] = [5, m, m + sd, m + 2 * sd, m + 3 * sd, m + 4 * sd, 60]
        let ticks: JSONValue = .array(tickValues.map { JSONValue.r($0) })
        let since: JSONValue = .int(DayMath.components(vix.days[0]).y)
        var kv: [(String, JSONValue)] = []
        kv.append(("current", .r(cur)))
        kv.append(("mean", .r(m)))
        kv.append(("sd", .r(sd)))
        kv.append(("zone", .string(zone)))
        kv.append(("levels", .array(levels)))
        kv.append(("base", baseJSON))
        kv.append(("since", since))
        kv.append(("term", term))
        kv.append(("skew", skew))
        kv.append(("move", move))
        kv.append(("ticks", ticks))
        return .object(kv)
    }

    struct Leadership {
        var json: JSONValue
        var names: [String]   // ranked order
    }

    static func leadershipPanel(_ D: RoRoData) -> Leadership {
        var rows: [(name: String, tickers: String, r13: Double, r4: Double, trend: String, mom: Double)] = []
        var hist: [(String, [Double])] = []
        for (name, ts) in RoRoSources.assetClasses {
            let series = ts.compactMap { D.yf($0) }
            guard !series.isEmpty else { continue }
            let r13 = (0..<D.count).map { i in Ops.mean(series.map { i >= 63 ? ($0[i] / $0[i - 63] - 1) * 100 : .nan }) }
            let r4 = (0..<D.count).map { i in Ops.mean(series.map { i >= 20 ? ($0[i] / $0[i - 20] - 1) * 100 : .nan }) }
            hist.append((name, zip(r13, r4).map { 0.6 * $0 + 0.4 * $1 }))
            let a = last(r13), b = last(r4)
            let trend = b > 1 ? "Rising" : (b < -1 ? "Falling" : "Steady")
            rows.append((name, ts.joined(separator: " · "), a, b, trend, 0.6 * a + 0.4 * b))
        }
        let ordered = rows.enumerated().sorted { x, y in
            let kx = x.element.mom.isNaN ? 1e9 : -x.element.mom
            let ky = y.element.mom.isNaN ? 1e9 : -y.element.mom
            return kx != ky ? kx < ky : x.offset < y.offset
        }.map(\.element)
        // H = DataFrame(hist).dropna(); ranks = H.rank(axis=1, ascending=False).iloc[::-5]
        let complete = (0..<D.count).filter { i in hist.allSatisfy { !$0.1[i].isNaN } }
        let eq = "Domestic Equities"
        var tenure = 0
        var eqRank: Int? = nil
        if let eqCol = hist.firstIndex(where: { $0.0 == eq }) {
            func rank(_ i: Int) -> Double {
                let v = hist[eqCol].1[i]
                let greater = hist.filter { $0.1[i] > v }.count
                let equal = hist.filter { $0.1[i] == v }.count
                return Double(greater) + Double(equal + 1) / 2   // average rank, 1 = highest
            }
            let weekly = stride(from: complete.count - 1, through: 0, by: -5).map { complete[$0] }
            if let first = weekly.first {
                eqRank = Int(rank(first))
                for i in weekly {
                    if Int(rank(i)) != eqRank { break }
                    tenure += 1
                }
            }
        }
        let json: JSONValue = .object([
            ("rows", .array(ordered.enumerated().map { i, r in
                .object([("name", .string(r.name)), ("tickers", .string(r.tickers)), ("r13", .r(r.r13)), ("r4", .r(r.r4)),
                         ("trend", .string(r.trend)), ("rank", .int(i + 1))])
            })),
            ("eq_rank", eqRank.map(JSONValue.int) ?? .null), ("eq_tenure_weeks", .int(tenure)), ("total", .int(ordered.count)),
            ("riskoff", .bool(eqRank != nil && eqRank! > 2)),
        ])
        return Leadership(json: json, names: ordered.map(\.name))
    }

    static func scenariosPanel(_ c: Core) -> JSONValue {
        var baseRow: [String: Double] = [:]
        for (k, v) in c.S { baseRow[k] = last(v) }
        let (_, baseHz) = compositesFromScores(baseRow)
        return .array(C.scenarios.map { sc in
            var row = baseRow
            var moves: [(String, Double)] = []
            for (fid, val) in sc.overrides {
                let f = C.factor(fid)!
                let new = Ops.interp(val, f.map)
                if let old = row[fid] { moves.append((f.name, new - old)) }
                row[fid] = new
            }
            let (_, hz) = compositesFromScores(row)
            let horizons: [JSONValue] = HZ.map { h in
                let today = last(c.comp[h]!)
                let after = Ops.pyRound(today + (hz[h]! - baseHz[h]!), 0)
                return .object([("key", .string(h)), ("label", .string(C.horizonMeta[h]!.label)), ("span", .string(C.horizonMeta[h]!.span)),
                                ("today", .r(today, 0)), ("after", .r(after, 0)), ("delta", .r(after - today, 0)), ("posture", .str(band(after)))])
            }
            let sortedMoves = moves.enumerated().sorted { a, b in
                abs(a.element.1) != abs(b.element.1) ? abs(a.element.1) > abs(b.element.1) : a.offset < b.offset
            }.map(\.element).prefix(5)
            return .object([("name", .string(sc.name)), ("dir", .string(sc.dir)), ("desc", .string(sc.desc)), ("analog", .string(sc.analog)),
                            ("horizons", .array(horizons)),
                            ("moves", .array(sortedMoves.map { .object([("name", .string($0.0)), ("delta", .r($0.1, 0))]) }))])
        })
    }

    static func analogsPanel(_ D: RoRoData, _ c: Core, count: Int = 5) -> JSONValue {
        guard let spx = D.yf("^GSPC") else { return .array([]) }
        let full = (0..<c.n).filter { i in c.B.allSatisfy { !$0.1[i].isNaN } }
        guard let lastFull = full.last else { return .array([]) }
        func vec(_ i: Int) -> [Double] { c.B.map { $0.1[i] } }
        func norm(_ v: [Double]) -> Double { v.reduce(0) { $0 + $1 * $1 }.squareRoot() }
        let now = vec(lastFull)
        let cutoff = c.index[lastFull] - 380
        // month-end rows on or before the cutoff
        var byMonth: [Int: Int] = [:]
        for i in full where c.index[i] <= cutoff {
            let comp = DayMath.components(c.index[i])
            byMonth[comp.y * 12 + comp.m] = i
        }
        let cand = byMonth.values.sorted()
        let nv = norm(now)
        let sims: [(i: Int, s: Double)] = cand.map { i in
            let r = vec(i)
            return (i, 1 - norm(zip(r, now).map { $0 - $1 }) / (norm(r) + nv + 1e-9))
        }
        func cosine(_ i: Int) -> Double {
            let r = vec(i)
            return zip(r, now).reduce(0) { $0 + $1.0 * $1.1 } / (norm(r) * nv + 1e-9)
        }
        var picks: [(Int, Double)] = []
        for (i, s) in sims.enumerated().sorted(by: { $0.element.s != $1.element.s ? $0.element.s > $1.element.s : $0.offset < $1.offset }).map(\.element) {
            if picks.allSatisfy({ abs(c.index[i] - c.index[$0.0]) > 270 }) { picks.append((i, s)) }
            if picks.count == count { break }
        }
        let post: [String?] = c.comp["intermediate"]!.map { band($0) }
        let ret = Ops.pctChange(spx, 1).map { $0.isNaN ? 0 : $0 }
        let inter = c.comp["intermediate"]!
        var out: [JSONValue] = []
        for (i, s) in picks {
            let end = min(i + 253, spx.count)
            let win = Array(spx[i..<end])
            func fwd(_ k: Int) -> JSONValue { i + k < spx.count ? .r((spx[i + k] / spx[i] - 1) * 100) : .null }
            var peak = -Double.infinity
            var maxdd = Double.nan
            for v in win where !v.isNaN {
                peak = max(peak, v)
                let dd = v / peak - 1
                if maxdd.isNaN || dd < maxdd { maxdd = dd }
            }
            // Out of the market while the Intermediate posture is DEFENSE, acting the next day.
            let lo = i + 1, hiPost = min(i + 253, post.count)
            let pos: [Double] = (lo..<hiPost).map { j in post[j - 1] != "DEFENSE" ? 1 : 0 }
            let r = Array(ret[lo..<min(i + 253, ret.count)].prefix(pos.count))
            var strat = 1.0, bh = 1.0, eq = 1.0, eqPeak = -Double.infinity, sdd = Double.nan
            for k in r.indices {
                strat *= 1 + pos[k] * r[k]
                bh *= 1 + r[k]
                eq *= 1 + pos[k] * r[k]
                eqPeak = max(eqPeak, eq)
                let dd = eq / eqPeak - 1
                if sdd.isNaN || dd < sdd { sdd = dd }
            }
            let stratR = Ops.pyRound((strat - 1) * 100, 1), bhR = Ops.pyRound((bh - 1) * 100, 1)
            let p = Array(post[i..<min(i + 253, post.count)])
            let pDays = Array(c.index[i..<min(i + 253, c.index.count)])
            var offDates: [Day] = [], onDates: [Day] = []
            for k in p.indices {
                let prev: String? = k > 0 ? p[k - 1] : nil
                if p[k] == "DEFENSE" && prev != "DEFENSE" { offDates.append(pDays[k]) }
                if p[k] != "DEFENSE" && k > 0 && prev == "DEFENSE" { onDates.append(pDays[k]) }
            }
            let startDef = p.first == "DEFENSE"
            let firstOff: Day? = startDef ? pDays.first : offDates.first
            let backOn: Day? = firstOff.flatMap { fo in onDates.first { $0 > fo } }
            var lowIdx = i
            var lowVal = Double.infinity
            for (k, v) in win.enumerated() where !v.isNaN && v < lowVal { lowVal = v; lowIdx = i + k }
            let net = Ops.pyRound(stratR - bhR, 1)
            let verdict = firstOff == nil ? "NO SIGNAL FIRED"
                : (net > 1 ? "SIGNAL WOULD HAVE HELPED" : (net < -1 ? "SIGNAL WOULD HAVE HURT" : "ROUGHLY EVEN"))
            var switches = 0
            for k in pos.indices.dropFirst() where abs(pos[k] - pos[k - 1]) > 0 { switches += 1 }
            out.append(.object([
                ("date", .string(DayMath.monthYear(c.index[i]))), ("iso", .string(DayMath.iso(c.index[i]))),
                ("sim", .r(s * 100, 0)), ("cos", .r(cosine(i) * 100, 0)),
                ("then", .object(c.B.map { ($0.0, .r($0.1[i], 0)) })),
                ("now", .object(c.B.map { ($0.0, .r($0.1[lastFull], 0)) })),
                ("comp_then", .r(inter[i], 0)),
                ("fwd3", fwd(63)), ("fwd6", fwd(126)), ("fwd12", fwd(252)), ("maxdd", .r(maxdd * 100)),
                ("strat", .r(stratR)), ("bh", .r(bhR)), ("strat_dd", .r(sdd * 100)), ("net", .r(net)), ("verdict", .string(verdict)),
                ("switches", .int(switches)),
                ("off", firstOff.map { .string(DayMath.long($0)) } ?? .null),
                ("on", backOn.map { .string(DayMath.long($0)) } ?? .null),
                ("low", .string(DayMath.long(D.index[lowIdx]))),
                ("days_out", .int(pos.filter { $0 == 0 }.count)), ("start_def", .bool(startDef)),
            ]))
        }
        return .array(out)
    }

    static func historyPanel(_ c: Core, months: Int = 24) -> JSONValue {
        let start = DayMath.subtractMonths(c.index[c.n - 1], months)
        let rows = c.index.indices.filter { c.index[$0] >= start }
        var kv: [(String, JSONValue)] = [("dates", .array(rows.map { .string(DayMath.iso(c.index[$0])) }))]
        for h in HZ { kv.append((h, .array(rows.map { .r(c.comp[h]![$0], 1) }))) }
        return .object(kv)
    }

    static func posturePanel(_ c: Core, _ lastRun: LastRun?) -> JSONValue {
        let inter = c.comp["intermediate"]!
        let idx = inter.indices.filter { !inter[$0].isNaN }
        let s = idx.map { inter[$0] }
        let v = Ops.pyRound(last(s), 0)
        let b = band(v)
        let bands = s.map { band(Ops.pyRound($0, 0)) }
        var since = c.index[idx[0]]
        for k in bands.indices where k == 0 || bands[k] != bands[k - 1] { since = c.index[idx[k]] }
        let prevV: Double, prevDate: String
        if let lastRun { prevV = lastRun.intermediate; prevDate = lastRun.date } else {
            prevV = back(s, 6); prevDate = DayMath.iso(c.index[idx[idx.count - 6]])
        }
        var lean = ""
        if b == "NEUTRAL" { lean = v > 5 ? "LEANING OFFENSE" : (v < -5 ? "LEANING DEFENSE" : "BALANCED") }
        let t = last(c.comp["tactical"]!)
        let tacAgree = (t > 5 && v > 5) || (t < -5 && v < -5) || (abs(t) <= 5 && abs(v) <= 5)
        let near = abs(C.offenseLine - v) < abs(v - C.defenseLine) ? "Offense" : "Defense"
        let flip = band(prevV) != b
        let approaching = b == "NEUTRAL" && min(abs(C.offenseLine - v), abs(v - C.defenseLine)) <= 5
        let status = flip ? "FLIPPED" : (approaching ? "WATCH" : "NO CHANGE")
        let play: String, direction: String
        if b == "OFFENSE" {
            play = "Press offense. Hold or add to equity exposure and let winners run; use pullbacks to add. Stay with it until the Intermediate dial closes back below +20."
            direction = "Stay long — defend below +20"
        } else if b == "DEFENSE" {
            play = "Protect capital. Trim equity toward underweight, raise cash and quality, keep duration. Wait for the Intermediate dial to close back above −20 before re-risking."
            direction = "Stay defensive — re-risk above −20"
        } else {
            play = "Decision zone — stay balanced. Hold benchmark weight and avoid big bets; this is where the next regime is decided. Let the Intermediate dial lead, not the headlines."
            direction = v >= 0 ? "Hold — ready to add above +20" : "Hold — ready to cut below −20"
        }
        return .object([
            ("value", .r(v, 0)), ("band", .str(b)), ("lean", .string(lean)), ("direction", .string(direction)), ("play", .string(play)),
            ("since", .string(DayMath.iso(since))), ("days_in", .int(idx.filter { c.index[$0] > since }.count + 1)),
            ("prev", .r(prevV, 0)), ("prev_date", .string(prevDate)), ("delta", .r(v - prevV, 0)),
            ("to_off", .r(C.offenseLine - v, 0)), ("to_def", .r(v - C.defenseLine, 0)),
            ("nearest", .string(near)), ("status", .string(status)), ("tac", .r(t, 0)), ("tac_agree", .bool(tacAgree)),
            ("strat", .r(last(c.comp["strategic"]!), 0)),
        ])
    }

    static let tilts: [String: [(String, String, String)]] = [
        "Risk-On Aggressive": [("↑", "EQUITIES", "Overweight · upper band"), ("↑", "CYCLICALS", "Tilt to high beta / cyclicals"),
                               ("↓", "DURATION", "Short duration"), ("↓", "CASH", "Minimal")],
        "Risk-On Constructive": [("↑", "EQUITIES", "Modest OW · neutral-to-upper band"), ("↑", "QUALITY", "Tilt to high-quality, profitable"),
                                 ("─", "CREDIT (IG)", "Hold investment grade"), ("─", "DURATION", "Neutral"), ("─", "CASH", "Modest, dry powder")],
        "Neutral": [("─", "EQUITIES", "Benchmark weight"), ("↑", "QUALITY", "Tilt to quality and low leverage"),
                    ("─", "CREDIT (IG)", "Hold investment grade"), ("─", "DURATION", "Neutral"), ("─", "CASH", "Modest, dry powder")],
        "Risk-Off Defensive": [("↓", "EQUITIES", "Underweight · lower band"), ("↑", "DEFENSIVES", "Staples, utilities, health care"),
                               ("↑", "DURATION", "Extend duration"), ("↓", "CREDIT (HY)", "Avoid high yield"), ("↑", "CASH", "Raise cash")],
        "Crisis": [("↓", "EQUITIES", "Minimum weight; scale back in on capitulation"), ("↑", "TREASURIES", "Long duration"),
                   ("↑", "CASH", "High"), ("↓", "CREDIT", "Avoid spread risk")],
    ]

    static func masterPanel(_ c: Core, _ lead: JSONValue) -> JSONValue {
        let v = last(c.comp["intermediate"]!), t = last(c.comp["tactical"]!), s = last(c.comp["strategic"]!)
        let rg = regime(v)
        let sameSign = ((t > 0) == (v > 0)) && ((v > 0) == (s > 0))
        let row = c.bucketRow(c.n - 1).map(\.1).filter { !$0.isNaN }
        let disp = (row.max() ?? .nan) - (row.min() ?? .nan)
        let conf: String
        if sameSign && abs(t - s) < 20 && disp < 80 { conf = "HIGH · ALIGNED" }
        else if sameSign || abs(t - s) < 30 { conf = "MEDIUM · MIXED" }
        else { conf = "LOW · DIVERGENT" }
        let head = ["Risk-On Aggressive": "ADD RISK", "Risk-On Constructive": "ADD RISK · CAUTIOUSLY",
                    "Neutral": "HOLD · BENCHMARK", "Risk-Off Defensive": "REDUCE RISK", "Crisis": "PROTECT CAPITAL"][rg]!
        var notes: [String] = []
        if t - s > 30 { notes.append("fast signals are running well ahead of the slow ones — take profits in extended longs and avoid adding to crowded names") }
        if s - t > 30 { notes.append("the slow backdrop is better than the tape — dips are more likely buyable than the start of something worse") }
        if let m = c.bucket("MACRO"), last(m) < -20 { notes.append("macro is the weak link; watch claims and the Sahm Rule") }
        if let cr = c.bucket("CREDIT"), last(cr) < -20 { notes.append("credit is under stress — respect it, it tends to lead equities") }
        let base = [
            "Risk-On Aggressive": "Run an overweight in equities with a cyclical tilt.",
            "Risk-On Constructive": "Maintain or modestly increase equity exposure. Tilt toward quality.",
            "Neutral": "Hold benchmark weights and wait for the Intermediate dial to break out of the ±20 band.",
            "Risk-Off Defensive": "Trim equities toward underweight, add duration and defensives.",
            "Crisis": "Defensive positioning; begin a staged plan to re-risk as credit and breadth stabilise.",
        ][rg]!
        let action = base + (notes.isEmpty ? "" : " Note: " + notes.joined(separator: "; ") + ".")
        let rows = lead["rows"]?.array ?? []
        func nr(_ r: JSONValue) -> JSONValue { .object([("name", r["name"]!), ("rank", r["rank"]!)]) }
        return .object([
            ("value", .r(v, 0)), ("regime", .string(rg)), ("head", .string(head)), ("confidence", .string(conf)), ("action", .string(action)),
            ("tilts", .array(tilts[rg]!.map { .object([("arrow", .string($0.0)), ("name", .string($0.1)), ("text", .string($0.2))]) })),
            ("favored", .array(rows.prefix(3).map(nr))),
            ("under", .array(rows.suffix(2).map(nr))),
        ])
    }

    // MARK: Build

    /// engine.build(D, last_run). `generated` is the run time shown on the dashboard.
    public static func build(_ D: RoRoData, lastRun: LastRun?, generated: Date = Date()) -> JSONValue {
        var core = computeCore(D)
        guard let lastValid = core.comp["intermediate"]!.lastIndex(where: { !$0.isNaN }) else {
            return .object([("error", .string("Not enough data to score the model."))])
        }
        core = trim(core, to: lastValid + 1)
        let lead = leadershipPanel(D)
        let stale = D.health.filter { $0.status != "ok" && $0.status != "synthetic" }
        let gen = DateFormatter()
        gen.locale = Locale(identifier: "en_US_POSIX")
        gen.dateFormat = "MMM dd, yyyy · HH:mm"
        let asof = core.index[lastValid]
        func healthJSON(_ h: RoRoHealth) -> JSONValue {
            .object([("source", .string(h.source)), ("id", .string(h.id)), ("status", .string(h.status)), ("last", .str(h.last))])
        }
        let nLive = C.factors.filter { f in core.score(f.id).map { !last($0).isNaN } ?? false }.count
        return .object([
            ("generated", .string(gen.string(from: generated))),
            ("asof", .string(DayMath.long(asof))), ("asof_iso", .string(DayMath.iso(asof))),
            ("demo", .bool(D.demo)),
            ("n_factors", .int(C.factors.count)), ("n_live", .int(nLive)),
            ("lines", .object([("off", .number(C.offenseLine)), ("de", .number(C.defenseLine)), ("crisis", .number(C.crisisLine))])),
            ("posture", posturePanel(core, lastRun)),
            ("master", masterPanel(core, lead.json)),
            ("horizons", .array(HZ.map { horizonPanel(core, $0) })),
            ("buckets", bucketsPanel(core)),
            ("history", historyPanel(core)),
            ("flags", flagsPanel(core)),
            ("vix", vixPanel(D)),
            ("breadth", core.raw["sectbreadth"].map { .r(last($0), 0) } ?? .null),
            ("leadership", lead.json),
            ("factors", factorTable(core)),
            ("scenarios", scenariosPanel(core)),
            ("analogs", analogsPanel(D, core)),
            ("health", .array(D.health.map(healthJSON))), ("stale", .array(stale.map(healthJSON))),
            ("weights", .object(HZ.map { h in (h, .object(BK.map { ($0, .number(C.horizonWeights[h]![$0]!)) })) })),
            ("bucket_names", .object(C.buckets.map { ($0.0, .string($0.1)) })),
        ])
    }

    /// Injects the model into the dashboard template (roro.py: html.replace("/*__DATA__*/null", json)).
    public static func render(template: String, model: JSONValue) -> String {
        template.replacingOccurrences(of: "/*__DATA__*/null", with: String(decoding: model.serialized(), as: UTF8.self))
    }
}
