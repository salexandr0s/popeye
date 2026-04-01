// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PopeyeMac",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "PopeyeAPI", targets: ["PopeyeAPI"]),
    ],
    targets: [
        .executableTarget(
            name: "PopeyeMac",
            dependencies: ["PopeyeAPI"],
            path: "Sources/PopeyeMac",
            exclude: ["Resources/Info.plist"]
        ),
        .target(
            name: "PopeyeAPI",
            path: "Sources/PopeyeAPI"
        ),
        .testTarget(
            name: "PopeyeAPITests",
            dependencies: ["PopeyeAPI"],
            path: "Tests/PopeyeAPITests",
            resources: [.process("Fixtures")]
        ),
        .testTarget(
            name: "PopeyeMacTests",
            dependencies: ["PopeyeAPI", "PopeyeMac"],
            path: "Tests/PopeyeMacTests"
        ),
    ]
)
