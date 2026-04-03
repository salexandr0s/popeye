import Foundation

enum BootstrapCLIResolutionError: LocalizedError, Sendable, Equatable {
    case bundledCLIIsNotExecutable(String)
    case invalidEnvironmentOverride(String)
    case cliNotFound(searchedLocations: [String])

    var errorDescription: String? {
        switch self {
        case .bundledCLIIsNotExecutable(let path):
            return "The bundled Popeye companion CLI exists but is not executable: \(path)"
        case .invalidEnvironmentOverride(let path):
            return "The POPEYE_MAC_BOOTSTRAP_CLI override points to a non-executable path: \(path)"
        case .cliNotFound(let searchedLocations):
            let joined = searchedLocations.joined(separator: ", ")
            return "Popeye CLI was not found. Checked \(joined)."
        }
    }
}
