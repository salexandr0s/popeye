import Foundation

public enum StoredCredentialKind: Sendable {
    case bearerToken
    case nativeSession

    var keychainAccount: String {
        switch self {
        case .bearerToken:
            return "bearer-token"
        case .nativeSession:
            return "native-session"
        }
    }
}
