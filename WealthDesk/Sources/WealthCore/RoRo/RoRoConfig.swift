import Foundation

/// Port of roro/config.py: factor universe, bucket/horizon weights and scenarios.
/// Score maps are piecewise-linear (reading, score) points; higher score = more risk-on.
public struct RoRoFactor {
    public let id: String
    public let name: String
    public let bucket: String
    public let weight: Double
    /// Python format "{:<sign>.<decimals>f}<suffix>"
    public let decimals: Int
    public let sign: Bool
    public let suffix: String
    public let scale: Double
    public let map: [(Double, Double)]
    public let src: String
    let calc: (RoRoData) -> [Double]?

    func format(_ v: Double) -> String {
        if v.isNaN { return "—" }
        return (Ops.fmt(v * scale, decimals: decimals, sign: sign) + suffix).replacingOccurrences(of: "-", with: "−")
    }
}

public struct RoRoScenario {
    public let name: String
    public let dir: String
    public let desc: String
    public let overrides: [(String, Double)]
    public let analog: String
}

public enum RoRoConfig {
    public static let buckets: [(String, String)] = [
        ("MACRO", "Macro / Growth"),
        ("MONETARY", "Monetary / Liquidity"),
        ("TECHNICALS", "Technicals / Breadth"),
        ("CREDIT", "Credit"),
        ("VOL", "Vol / Sentiment"),
        ("CROSS", "Cross-Asset"),
    ]
    public static var bucketKeys: [String] { buckets.map(\.0) }
    public static func bucketName(_ k: String) -> String { buckets.first { $0.0 == k }?.1 ?? k }

    public static let horizons = ["tactical", "intermediate", "strategic"]

    public static let horizonWeights: [String: [String: Double]] = [
        "tactical": ["MACRO": 5, "MONETARY": 10, "TECHNICALS": 30, "CREDIT": 15, "VOL": 25, "CROSS": 15],
        "intermediate": ["MACRO": 15, "MONETARY": 15, "TECHNICALS": 25, "CREDIT": 20, "VOL": 10, "CROSS": 15],
        "strategic": ["MACRO": 30, "MONETARY": 25, "TECHNICALS": 10, "CREDIT": 20, "VOL": 5, "CROSS": 10],
    ]
    public static let horizonSmoothing: [String: Double] = ["tactical": 1, "intermediate": 5, "strategic": 20]
    public static let horizonMeta: [String: (label: String, span: String, desc: String)] = [
        "tactical": ("Tactical", "1–4W", "1 to 4 weeks · forward"),
        "intermediate": ("Intermediate", "1–3M", "1 to 3 months · forward"),
        "strategic": ("Strategic", "3–12M", "3 to 12 months · forward"),
    ]

    public static let offenseLine = 20.0
    public static let defenseLine = -20.0
    public static let crisisLine = -60.0
    public static let signalOn = 25.0
    public static let signalOff = -25.0

    // MARK: Helpers (config.py)

    static func chg(_ s: [Double]?, _ n: Int = 63) -> [Double]? { s.map { Ops.pctChange($0, n).map { $0 * 100 } } }

    static func ratioChg(_ a: [Double]?, _ b: [Double]?, _ n: Int = 63) -> [Double]? {
        guard let a, let b else { return nil }
        return chg(Ops.zipWith(a, b, /), n)
    }

    static func vsMA(_ s: [Double]?, _ n: Int) -> [Double]? {
        guard let s else { return nil }
        let ma = Ops.rollingMean(s, n, minp: Int(Double(n) * 0.8))
        return Ops.zipWith(s, ma) { ($0 / $1 - 1) * 100 }
    }

    static func maSlope(_ s: [Double]?, _ n: Int = 200, lag: Int = 63) -> [Double]? {
        guard let s else { return nil }
        return chg(Ops.rollingMean(s, n, minp: Int(Double(n) * 0.8)), lag)
    }

    static func nativeThenDaily(_ D: RoRoData, _ sid: String, _ f: ([Double]) -> [Double]) -> [Double]? {
        guard let raw = D.fredRaw(sid) else { return nil }
        return D.daily(raw.map(f))
    }

    static func diff(_ s: [Double]?, _ n: Int) -> [Double]? {
        guard let s else { return nil }
        return Ops.zipWith(s, Ops.shift(s, n), -)
    }

    static func sectorBreadth(_ D: RoRoData) -> [Double]? {
        var above: [[Double]] = []
        for t in RoRoSources.sectors {
            guard let s = D.yf(t) else { continue }
            let ma = Ops.rollingMean(s, 200, minp: 160)
            above.append(zip(s, ma).map { v, m in m.isNaN ? .nan : (v > m ? 1 : 0) })
        }
        guard !above.isEmpty else { return nil }
        return (0..<D.count).map { i in Ops.mean(above.map { $0[i] }) * 100 }
    }

    static func netLiquidity(_ D: RoRoData) -> [Double]? {
        guard let walcl = D.fredRaw("WALCL"), let tga = D.fredRaw("WTREGEN"),
              let w = D.daily(walcl), let t = D.daily(tga) else { return nil }
        let rrp = D.fredRaw("RRPONTSYD").flatMap { D.daily($0) }?.map { ($0.isNaN ? 0 : $0) * 1000 }
        return w.indices.map { w[$0] - t[$0] - (rrp?[$0] ?? 0) }
    }

    static func realFFR(_ D: RoRoData) -> [Double]? {
        guard let pce = D.fredRaw("PCEPILFE"), let dff = D.fred("DFF"),
              let infl = D.daily(pce.map { Ops.pctChange($0, 12).map { $0 * 100 } }) else { return nil }
        return Ops.zipWith(dff, infl, -)
    }

    static func drawdown52w(_ s: [Double]?) -> [Double]? {
        guard let s else { return nil }
        let mx = Ops.rollingMax(s, 252, minp: 200)
        return Ops.zipWith(s, mx) { ($0 / $1 - 1) * 100 }
    }

    static func ratio(_ a: [Double]?, _ b: [Double]?) -> [Double]? {
        guard let a, let b else { return nil }
        return Ops.zipWith(a, b, /)
    }

    static func f(_ id: String, _ name: String, _ bucket: String, _ weight: Double, _ fmt: (Int, Bool, String),
                  scale: Double = 1, _ map: [(Double, Double)], _ src: String, _ calc: @escaping (RoRoData) -> [Double]?) -> RoRoFactor {
        RoRoFactor(id: id, name: name, bucket: bucket, weight: weight, decimals: fmt.0, sign: fmt.1, suffix: fmt.2,
                   scale: scale, map: map, src: src, calc: calc)
    }

    // MARK: Factor universe

    public static let factors: [RoRoFactor] = [
        // MACRO / GROWTH
        f("sahm", "Sahm Rule (real-time)", "MACRO", 30, (2, false, ""),
          [(-0.2, 50), (0.0, 40), (0.3, 0), (0.5, -80), (0.8, -100)], "FRED SAHMREALTIME") { $0.fred("SAHMREALTIME") },
        f("claims", "Initial Claims · 4w MA, YoY", "MACRO", 25, (1, true, "%"),
          [(-10, 50), (0, 20), (10, -20), (20, -60), (35, -100)], "FRED ICSA") { D in
            nativeThenDaily(D, "ICSA") { Ops.pctChange(Ops.rollingMean($0, 4), 52).map { $0 * 100 } } },
        f("unrate", "Unemployment vs 12m MA", "MACRO", 20, (2, true, " pp"),
          [(-0.3, 40), (0.0, 20), (0.2, 0), (0.5, -80), (0.8, -100)], "FRED UNRATE") { D in
            nativeThenDaily(D, "UNRATE") { Ops.zipWith($0, Ops.rollingMean($0, 12), -) } },
        f("cfnai", "Chicago Fed Activity (CFNAI 3m)", "MACRO", 25, (2, true, ""),
          [(-0.7, -100), (-0.35, -40), (0.0, 10), (0.2, 40), (0.5, 70)], "FRED CFNAIMA3") { $0.fred("CFNAIMA3") },
        f("permits", "Building Permits YoY", "MACRO", 15, (1, true, "%"),
          [(-25, -100), (-10, -40), (0, 0), (10, 40), (20, 60)], "FRED PERMIT") { D in
            nativeThenDaily(D, "PERMIT") { Ops.pctChange($0, 12).map { $0 * 100 } } },
        f("indpro", "Industrial Production YoY", "MACRO", 15, (1, true, "%"),
          [(-4, -100), (-1, -40), (0, -10), (2, 40), (4, 70)], "FRED INDPRO") { D in
            nativeThenDaily(D, "INDPRO") { Ops.pctChange($0, 12).map { $0 * 100 } } },

        // MONETARY / LIQUIDITY
        f("t10y3m", "3m10y Yield Curve", "MONETARY", 25, (2, true, "%"),
          [(-1.5, -80), (-0.5, -40), (0.0, 0), (0.75, 30), (2.0, 50)], "FRED T10Y3M") { $0.fred("T10Y3M") },
        f("t10y2y", "2s10s Yield Curve", "MONETARY", 10, (2, true, "%"),
          [(-1.0, -60), (0.0, 0), (1.0, 30), (2.0, 40)], "FRED T10Y2Y") { $0.fred("T10Y2Y") },
        f("nfci", "Chicago Fed NFCI", "MONETARY", 25, (2, true, ""),
          [(-0.6, 60), (-0.3, 25), (0.0, -20), (0.5, -80), (1.0, -100)], "FRED NFCI") { $0.fred("NFCI") },
        f("realffr", "Real Fed Funds (vs core PCE)", "MONETARY", 15, (2, true, "%"),
          [(-2, 60), (0, 30), (1, 0), (2, -50), (3, -90)], "FRED DFF, PCEPILFE", realFFR),
        f("netliq", "Net Fed Liquidity (13w Δ)", "MONETARY", 25, (1, true, "%"),
          [(-5, -100), (-2, -50), (0, 0), (2, 50), (5, 100)], "FRED WALCL − WTREGEN − RRPONTSYD") { chg(netLiquidity($0), 63) },
        f("dgs10chg", "10y Yield · 3m change", "MONETARY", 15, (2, true, " pp"),
          [(-0.75, 40), (0.0, 0), (0.5, -40), (1.0, -80), (1.5, -100)], "FRED DGS10") { diff($0.fred("DGS10"), 63) },

        // TECHNICALS / BREADTH
        f("spx200", "SPX vs. 200-DMA", "TECHNICALS", 25, (1, true, "%"),
          [(-10, -100), (-3, -40), (0, 0), (3, 30), (8, 60), (15, 30)], "Yahoo ^GSPC") { vsMA($0.yf("^GSPC"), 200) },
        f("slope200", "200-DMA Slope (3m)", "TECHNICALS", 20, (1, true, "%"),
          [(-4, -100), (-1, -40), (0, 0), (1, 40), (4, 100)], "Yahoo ^GSPC") { maSlope($0.yf("^GSPC")) },
        f("spx50", "SPX vs. 50-DMA", "TECHNICALS", 15, (1, true, "%"),
          [(-6, -80), (-2, -30), (0, 0), (2, 25), (5, 50)], "Yahoo ^GSPC") { vsMA($0.yf("^GSPC"), 50) },
        f("sectbreadth", "% Sector ETFs above 200-DMA", "TECHNICALS", 20, (0, false, "%"),
          [(0, -100), (30, -50), (50, 0), (70, 40), (90, 70)], "Yahoo XL* sector SPDRs", sectorBreadth),
        f("rspspy", "Equal-weight vs Cap-weight (RSP:SPY 13w)", "TECHNICALS", 10, (1, true, "%"),
          [(-4, -70), (0, 0), (4, 60)], "Yahoo RSP, SPY") { ratioChg($0.yf("RSP"), $0.yf("SPY")) },
        f("nyaspx", "NYSE Composite vs SPX (13w)", "TECHNICALS", 10, (1, true, "%"),
          [(-4, -70), (0, 0), (4, 60)], "Yahoo ^NYA, ^GSPC") { ratioChg($0.yf("^NYA"), $0.yf("^GSPC")) },
        f("dd52", "SPX Drawdown from 52w High", "TECHNICALS", 15, (1, true, "%"),
          [(-20, -100), (-10, -60), (-5, -20), (-2, 10), (0, 30)], "Yahoo ^GSPC") { drawdown52w($0.yf("^GSPC")) },

        // CREDIT
        f("hyoas", "HY OAS", "CREDIT", 30, (0, false, " bp"), scale: 100,
          [(3.0, 60), (3.5, 40), (4.5, 0), (6.0, -60), (8.0, -100)], "FRED BAMLH0A0HYM2") { $0.fred("BAMLH0A0HYM2") },
        f("igoas", "IG OAS", "CREDIT", 20, (0, false, " bp"), scale: 100,
          [(0.8, 50), (1.0, 30), (1.4, 0), (2.0, -60), (3.0, -100)], "FRED BAMLC0A0CM") { $0.fred("BAMLC0A0CM") },
        f("hyig", "HY/IG Spread Ratio", "CREDIT", 15, (2, false, ""),
          [(2.8, 40), (3.5, 0), (4.0, -40), (5.0, -80)], "FRED (derived)") { ratio($0.fred("BAMLH0A0HYM2"), $0.fred("BAMLC0A0CM")) },
        f("hychg", "HY OAS · 3m change", "CREDIT", 20, (0, true, " bp"), scale: 100,
          [(-0.75, 40), (0.0, 10), (0.5, -40), (1.5, -100)], "FRED BAMLH0A0HYM2") { diff($0.fred("BAMLH0A0HYM2"), 63) },
        f("baa10y", "Moody's Baa − 10y Treasury", "CREDIT", 15, (2, false, "%"),
          [(1.5, 40), (2.0, 10), (2.5, -20), (3.5, -80), (5.0, -100)], "FRED BAA10Y") { $0.fred("BAA10Y") },

        // VOL / SENTIMENT
        f("vix", "VIX (Colas regime, contrarian)", "VOL", 25, (1, false, ""),
          [(10, -30), (13, 0), (19.5, 10), (27.3, 40), (35, 70), (43, 100)], "Yahoo ^VIX") { $0.yf("^VIX") },
        f("vixterm", "VIX / VIX3M Term Structure", "VOL", 25, (2, false, ""),
          [(0.8, 40), (0.9, 20), (1.0, -20), (1.1, -70), (1.2, -100)], "Yahoo ^VIX, ^VIX3M") { ratio($0.yf("^VIX"), $0.yf("^VIX3M")) },
        f("skew", "SKEW Index", "VOL", 15, (0, false, ""),
          [(120, 30), (135, 0), (150, -35), (165, -60)], "Yahoo ^SKEW") { $0.yf("^SKEW") },
        f("move", "MOVE Index (bond vol)", "VOL", 20, (0, false, ""),
          [(70, 40), (90, 20), (110, -10), (130, -50), (160, -100)], "Yahoo ^MOVE") { $0.yf("^MOVE") },
        f("vixspike", "VIX · 1m change", "VOL", 15, (1, true, " pts"),
          [(-5, 30), (0, 0), (5, -40), (10, -80), (20, -100)], "Yahoo ^VIX") { diff($0.yf("^VIX"), 21) },

        // CROSS-ASSET (13-week % change of risk-appetite ratios)
        f("sphb", "SPHB:SPLV (HiBeta/LowVol)", "CROSS", 15, (1, true, "%"),
          [(-8, -80), (0, 0), (8, 80)], "Yahoo SPHB, SPLV") { ratioChg($0.yf("SPHB"), $0.yf("SPLV")) },
        f("hygief", "HYG:IEF (HY/Treasury)", "CROSS", 15, (1, true, "%"),
          [(-4, -80), (0, 0), (4, 80)], "Yahoo HYG, IEF") { ratioChg($0.yf("HYG"), $0.yf("IEF")) },
        f("xlyxlp", "XLY:XLP (Disc/Staples)", "CROSS", 15, (1, true, "%"),
          [(-8, -80), (0, 0), (8, 80)], "Yahoo XLY, XLP") { ratioChg($0.yf("XLY"), $0.yf("XLP")) },
        f("iwfiwd", "Growth/Value (IWF:IWD)", "CROSS", 10, (1, true, "%"),
          [(-8, -60), (0, 0), (8, 60)], "Yahoo IWF, IWD") { ratioChg($0.yf("IWF"), $0.yf("IWD")) },
        f("cugold", "Copper:Gold (13w)", "CROSS", 15, (1, true, "%"),
          [(-10, -80), (0, 0), (10, 80)], "Yahoo HG=F, GC=F") { ratioChg($0.yf("HG=F"), $0.yf("GC=F")) },
        f("spxgold", "SPX:Gold (13w)", "CROSS", 10, (1, true, "%"),
          [(-10, -80), (0, 0), (10, 80)], "Yahoo ^GSPC, GC=F") { ratioChg($0.yf("^GSPC"), $0.yf("GC=F")) },
        f("dxy", "DXY Trend (vs 200-DMA)", "CROSS", 10, (1, true, "%"),
          [(-4, 40), (0, 0), (4, -50)], "Yahoo DX-Y.NYB") { vsMA($0.yf("DX-Y.NYB"), 200) },
        f("audjpy", "AUD/JPY (13w)", "CROSS", 10, (1, true, "%"),
          [(-6, -80), (0, 0), (6, 80)], "Yahoo AUDJPY=X") { chg($0.yf("AUDJPY=X")) },
    ]

    public static func factor(_ id: String) -> RoRoFactor? { factors.first { $0.id == id } }

    // MARK: Scenarios (overrides are RAW readings, before `scale`)

    public static let scenarios: [RoRoScenario] = [
        RoRoScenario(name: "Recession Onset", dir: "RISK-OFF",
                     desc: "Sahm Rule trips, claims surge, activity contracts, credit widens and breadth breaks.",
                     overrides: [("sahm", 0.6), ("claims", 30), ("unrate", 0.6), ("cfnai", -0.6), ("indpro", -2), ("hyoas", 6.0), ("hychg", 1.5),
                                 ("sectbreadth", 25), ("spx200", -6), ("slope200", -1.5), ("dd52", -14)],
                     analog: "Sep 2007 · Mar 2020"),
        RoRoScenario(name: "Credit Crunch", dir: "RISK-OFF",
                     desc: "HY OAS past 700 bp, IG to 200 bp, MOVE above 160, conditions tighten sharply.",
                     overrides: [("hyoas", 7.0), ("igoas", 2.0), ("hyig", 3.5), ("hychg", 3.0), ("baa10y", 3.5), ("move", 165), ("nfci", 0.6),
                                 ("hygief", -6)],
                     analog: "Sep 2008 · Mar 2020 · Aug 2011"),
        RoRoScenario(name: "Geopolitical Shock", dir: "RISK-OFF",
                     desc: "Conflict escalation: VIX spikes into the 30s, oil and gold surge, dollar bid.",
                     overrides: [("vix", 34), ("vixterm", 1.15), ("vixspike", 14), ("move", 140), ("spxgold", -12), ("dxy", 4), ("audjpy", -8),
                                 ("spx50", -6), ("dd52", -9)],
                     analog: "Aug 1990 · Sep 2001 · Feb 2022"),
        RoRoScenario(name: "Inflation Re-Acceleration", dir: "RISK-OFF",
                     desc: "Core PCE back above 3%, hawkish Fed surprise, long yields jump.",
                     overrides: [("realffr", 2.2), ("dgs10chg", 1.0), ("t10y2y", -0.5), ("move", 135), ("iwfiwd", -8), ("hychg", 0.6),
                                 ("netliq", -3)],
                     analog: "H1 2022 · 1994"),
        RoRoScenario(name: "China Hard Landing", dir: "RISK-OFF",
                     desc: "Copper −20%, EM equities slide, USD strengthens sharply.",
                     overrides: [("cugold", -18), ("dxy", 5), ("audjpy", -10), ("cfnai", -0.3), ("indpro", -1), ("spx50", -4)],
                     analog: "Aug 2015 · Q4 2018"),
        RoRoScenario(name: "Soft Landing Confirmed", dir: "RISK-ON",
                     desc: "Activity re-accelerates, claims stable, breadth broadens out.",
                     overrides: [("cfnai", 0.3), ("indpro", 3), ("permits", 12), ("claims", -5), ("sectbreadth", 85), ("rspspy", 4),
                                 ("nyaspx", 3), ("sphb", 6)],
                     analog: "1995 · 2014 · late 2019"),
        RoRoScenario(name: "Fed Pivot · 50bp Surprise", dir: "RISK-ON",
                     desc: "Unexpected 50bp cut, more signalled; real FFR drops and liquidity expands.",
                     overrides: [("realffr", -0.5), ("nfci", -0.6), ("t10y2y", 1.0), ("netliq", 4), ("dgs10chg", -0.6), ("dxy", -3)],
                     analog: "Jul 1995 · Aug 2019"),
    ]
}
