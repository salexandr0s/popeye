import Foundation

public enum ControlAPICredential: Sendable {
    case bearerToken(String)
    case nativeSession(String)
}
