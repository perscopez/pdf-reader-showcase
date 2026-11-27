// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PDFReaderNative",
    platforms: [
        .macOS(.v14),
        .iOS(.v17)
    ],
    products: [
        .executable(name: "PDFReaderNative", targets: ["PDFReaderNative"])
    ],
    targets: [
        .executableTarget(
            name: "PDFReaderNative",
            path: "Sources/PDFReaderNative"
        )
    ]
)
