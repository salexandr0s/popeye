import Foundation

public struct EmailDomainService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadAccounts() async throws -> [EmailAccountDTO] {
        try await client.listEmailAccounts()
    }

    public func loadThreads(accountId: String, limit: Int = 50, unreadOnly: Bool = false) async throws -> [EmailThreadDTO] {
        try await client.listEmailThreads(accountId: accountId, limit: limit, unreadOnly: unreadOnly)
    }

    public func loadThread(id: String) async throws -> EmailThreadDTO {
        try await client.getEmailThread(id: id)
    }

    public func loadDigest(accountId: String) async throws -> EmailDigestDTO? {
        try await client.emailDigest(accountId: accountId)
    }
}
