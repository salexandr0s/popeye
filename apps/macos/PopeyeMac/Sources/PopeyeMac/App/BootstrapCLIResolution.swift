import Foundation

struct BootstrapCLIResolution: Sendable, Equatable {
    let executableURL: URL
    let source: BootstrapCLIResolutionSource
}
