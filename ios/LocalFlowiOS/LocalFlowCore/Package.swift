// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "LocalFlowCore",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .library(name: "LocalFlowCore", targets: ["LocalFlowCore"])
    ],
    targets: [
        .target(name: "LocalFlowCore"),
        .testTarget(name: "LocalFlowCoreTests", dependencies: ["LocalFlowCore"])
    ]
)
