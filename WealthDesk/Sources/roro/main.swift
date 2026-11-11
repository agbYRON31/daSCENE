import Foundation
import WealthCore

// Developer tool for the RoRo port.
//   roro fetch <cacheDir>                 download every series into the cache
//   roro build <cacheDir> <out.json>      score the model from the cache and write its JSON
let args = CommandLine.arguments
func usage() -> Never {
    print("usage: roro fetch <cacheDir> | roro build <cacheDir> <out.json>")
    exit(2)
}
guard args.count >= 3 else { usage() }
let cache = URL(fileURLWithPath: args[2])

switch args[1] {
case "fetch":
    let sem = DispatchSemaphore(value: 0)
    Task {
        let start = Date()
        let d = await RoRoFetcher.load(cacheDir: cache) { n, total in
            if n % 10 == 0 || n == total { FileHandle.standardError.write("  \(n)/\(total)\n".data(using: .utf8)!) }
        }
        let bad = d.health.filter { $0.status != "ok" }
        print("fetched \(d.fredRawSeries.count) FRED + \(d.yahooRawSeries.count) Yahoo series in \(Int(Date().timeIntervalSince(start)))s; last business day \(DayMath.iso(d.index.last!))")
        for h in bad { print("  \(h.source) \(h.id): \(h.status)") }
        sem.signal()
    }
    sem.wait()
case "build":
    guard args.count >= 4 else { usage() }
    let d = RoRoFetcher.loadCache(cache)
    let model = RoRoEngine.build(d, lastRun: nil)
    try! model.serialized(pretty: true).write(to: URL(fileURLWithPath: args[3]))
    print("wrote \(args[3])")
default:
    usage()
}
