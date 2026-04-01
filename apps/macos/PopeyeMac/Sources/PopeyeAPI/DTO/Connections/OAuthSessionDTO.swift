import Foundation

public struct OAuthSessionDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let providerKind: String
    public let domain: String
    public let status: String
    public let authorizationUrl: String
    public let redirectUri: String
    public let connectionId: String?
    public let accountId: String?
    public let error: String?
    public let createdAt: String
    public let expiresAt: String
    public let completedAt: String?

    public init(
        id: String,
        providerKind: String,
        domain: String,
        status: String,
        authorizationUrl: String,
        redirectUri: String,
        connectionId: String?,
        accountId: String?,
        error: String?,
        createdAt: String,
        expiresAt: String,
        completedAt: String?
    ) {
        self.id = id
        self.providerKind = providerKind
        self.domain = domain
        self.status = status
        self.authorizationUrl = authorizationUrl
        self.redirectUri = redirectUri
        self.connectionId = connectionId
        self.accountId = accountId
        self.error = error
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.completedAt = completedAt
    }
}

public struct OAuthConnectStartInput: Encodable, Sendable {
    public let providerKind: String
    public let connectionId: String?
    public let mode: String
    public let syncIntervalSeconds: Int

    public init(
        providerKind: String,
        connectionId: String? = nil,
        mode: String = "read_only",
        syncIntervalSeconds: Int = 900
    ) {
        self.providerKind = providerKind
        self.connectionId = connectionId
        self.mode = mode
        self.syncIntervalSeconds = syncIntervalSeconds
    }
}
