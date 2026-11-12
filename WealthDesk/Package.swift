// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "WealthDesk",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "WealthDesk", targets: ["WealthDesk"]),
        .executable(name: "wdcheck", targets: ["wdcheck"]),
        .executable(name: "roro", targets: ["roro"]),
        .executable(name: "wdparity", targets: ["wdparity"]),
    ],
    targets: [
        .target(name: "WealthCore"),
        .executableTarget(name: "WealthDesk", dependencies: ["WealthCore"]),
        .executableTarget(name: "wdcheck", dependencies: ["WealthCore"]),
        .executableTarget(name: "roro", dependencies: ["WealthCore"]),
        .executableTarget(name: "offlinecheck", dependencies: ["WealthCore"]),
        .executableTarget(name: "wdparity", dependencies: ["WealthCore"]),
    ]
)
