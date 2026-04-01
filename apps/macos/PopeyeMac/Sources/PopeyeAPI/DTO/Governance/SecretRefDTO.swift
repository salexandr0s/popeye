import Foundation

public struct SecretRefDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let provider: String
    public let key: String
    public let createdAt: String
    public let rotatedAt: String?
    public let expiresAt: String?
    public let connectionId: String?
    public let description: String

    public init(
        id: String,
        provider: String,
        key: String,
        createdAt: String,
        rotatedAt: String?,
        expiresAt: String?,
        connectionId: String?,
        description: String
    ) {
        self.id = id
        self.provider = provider
        self.key = key
        self.createdAt = createdAt
        self.rotatedAt = rotatedAt
        self.expiresAt = expiresAt
        self.connectionId = connectionId
        self.description = description
    }
}

public struct StoreSecretInput: Encodable, Sendable {
    public let provider: String?
    public let key: String
    public let value: String
    public let connectionId: String?
    public let description: String?

    public init(
        provider: String? = nil,
        key: String,
        value: String,
        connectionId: String? = nil,
        description: String? = nil
    ) {
        self.provider = provider
        self.key = key
        self.value = value
        self.connectionId = connectionId
        self.description = description
    }
}
