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

    public func search(query: String, accountId: String, limit: Int = 20) async throws -> EmailSearchResponseDTO {
        try await client.searchEmail(query: query, accountId: accountId, limit: limit)
    }

    public func sync(accountId: String) async throws -> EmailSyncResultDTO {
        try await client.syncEmailAccount(accountId: accountId)
    }

    public func generateDigest(accountId: String) async throws -> EmailDigestDTO? {
        try await client.generateEmailDigest(accountId: accountId)
    }

    public func loadDrafts(accountId: String, limit: Int = 20) async throws -> [EmailDraftDTO] {
        try await client.listEmailDrafts(accountId: accountId, limit: limit)
    }

    public func loadDraft(id: String) async throws -> EmailDraftDetailDTO {
        try await client.getEmailDraft(id: id)
    }

    public func createDraft(input: EmailDraftCreateInput) async throws -> EmailDraftDTO {
        try await client.createEmailDraft(input: input)
    }

    public func updateDraft(id: String, input: EmailDraftUpdateInput) async throws -> EmailDraftDTO {
        try await client.updateEmailDraft(id: id, input: input)
    }
}
