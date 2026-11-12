import Foundation
import WealthCore
// Offline behaviour of the data layer, run with network access denied by sandbox-exec.
let sem = DispatchSemaphore(value: 0)
Task {
    let empty = URL(fileURLWithPath: CommandLine.arguments[1])
    let cached = URL(fileURLWithPath: CommandLine.arguments[2])
    let a = await RoRoFetcher.load(cacheDir: empty)
    print("no cache, no network: fetched", a.health.filter { $0.status == "ok" }.count, "missing", a.health.filter { $0.status == "missing" }.count,
          "| model:", RoRoEngine.build(a, lastRun: nil)["error"]?.string ?? "built")
    let b = await RoRoFetcher.load(cacheDir: cached)
    let m = RoRoEngine.build(b, lastRun: nil)
    print("cache, no network: fetched", b.health.filter { $0.status == "ok" }.count, "from cache", b.health.filter { $0.status.contains("using cache") }.count,
          "| model as of", m["asof"]?.string ?? "ERROR", "| stale flagged:", m["stale"]?.array?.count ?? -1)
    do { _ = try await URLSession.shared.data(from: MarketParsers.treasuryURL(year: 2026)); print("treasury: UNEXPECTEDLY reachable") }
    catch { print("treasury: unreachable as expected (\(error.localizedDescription.prefix(50)))") }
    sem.signal()
}
sem.wait()
