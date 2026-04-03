import Foundation

enum BootstrapCLIResolutionSource: String, Sendable {
    case bundled
    case envOverride
    case standardLocation
    case whichLookup

    var displayName: String {
        switch self {
        case .bundled:
            return "bundled companion CLI"
        case .envOverride:
            return "POPEYE_MAC_BOOTSTRAP_CLI override"
        case .standardLocation:
            return "standard install location"
        case .whichLookup:
            return "`which pop` lookup"
        }
    }
}
