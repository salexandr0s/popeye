import Foundation

public struct ProviderAuthConfigDTO: Codable, Sendable, Identifiable, Equatable {
    public let provider: String
    public let clientId: String?
    public let clientSecretRefId: String?
    public let secretAvailability: String
    public let status: String
    public let details: String

    public var id: String { provider }

    public var isReady: Bool {
        status == "ready"
    }
}

public struct ProviderAuthConfigUpdateInput: Codable, Sendable, Equatable {
    public let clientId: String?
    public let clientSecret: String?
    public let clearStoredSecret: Bool

    public init(
        clientId: String?,
        clientSecret: String?,
        clearStoredSecret: Bool = false
    ) {
        self.clientId = clientId
        self.clientSecret = clientSecret
        self.clearStoredSecret = clearStoredSecret
    }
}
