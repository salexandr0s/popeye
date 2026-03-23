import Foundation

public struct CsrfTokenDTO: Codable, Sendable {
    public let token: String
}
