import Foundation

public struct OAuthProviderAvailabilityDTO: Codable, Sendable, Identifiable, Equatable {
    public let providerKind: String
    public let domain: String
    public let status: String
    public let details: String

    public var id: String { providerKind }

    public var isReady: Bool {
        status == "ready"
    }
}
