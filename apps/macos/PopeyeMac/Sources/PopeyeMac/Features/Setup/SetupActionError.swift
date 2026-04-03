import Foundation

enum SetupActionError: LocalizedError {
    case invalidAuthorizationURL
    case browserLaunchFailed
    case oauthFailed(String)
    case oauthExpired
    case oauthTimedOut

    var errorDescription: String? {
        switch self {
        case .invalidAuthorizationURL:
            "The daemon returned an invalid browser authorization URL."
        case .browserLaunchFailed:
            "The Mac app could not open the default browser for setup."
        case .oauthFailed(let message):
            message
        case .oauthExpired:
            "The browser setup session expired. Start the provider setup again."
        case .oauthTimedOut:
            "Still waiting for browser completion. Finish the provider auth in your browser, then try Refresh if needed."
        }
    }
}
