import Foundation

enum BootstrapOnboardingStep: Sendable {
    case checking
    case createLocalSetup
    case startDaemon
    case grantLocalAccess
    case manualFallback
}
