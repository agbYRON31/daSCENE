// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "WealthDesk",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "WealthDesk", targets: ["WealthDesk"]),
        .executable(name: "wdcheck", targets: ["wdcheck"]),
    ],
    targets: [
        .target(name: "WealthCore"),
        .executableTarget(name: "WealthDesk", dependencies: ["WealthCore"]),
        .executableTarget(name: "wdcheck", dependencies: ["WealthCore"]),
    ]
)
