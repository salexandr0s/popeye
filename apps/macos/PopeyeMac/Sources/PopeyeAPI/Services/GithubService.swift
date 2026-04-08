import Foundation

public struct GithubService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadAccounts() async throws -> [GithubAccountDTO] {
        try await client.listGithubAccounts()
    }

    public func loadRepos(accountId: String, limit: Int = 50) async throws -> [GithubRepoDTO] {
        try await client.listGithubRepos(accountId: accountId, limit: limit)
    }

    public func loadPullRequests(accountId: String, limit: Int = 50) async throws -> [GithubPullRequestDTO] {
        try await client.listGithubPullRequests(accountId: accountId, state: "open", limit: limit)
    }

    public func loadPullRequest(id: String) async throws -> GithubPullRequestDTO {
        try await client.getGithubPullRequest(id: id)
    }

    public func loadIssues(accountId: String, limit: Int = 50) async throws -> [GithubIssueDTO] {
        try await client.listGithubIssues(accountId: accountId, state: "open", assigned: nil, limit: limit)
    }

    public func loadIssue(id: String) async throws -> GithubIssueDTO {
        try await client.getGithubIssue(id: id)
    }

    public func loadNotifications(accountId: String, limit: Int = 25) async throws -> [GithubNotificationDTO] {
        try await client.listGithubNotifications(accountId: accountId, limit: limit)
    }

    public func loadDigest(accountId: String) async throws -> GithubDigestDTO? {
        try await client.githubDigest(accountId: accountId)
    }

    public func search(
        query: String,
        accountId: String,
        entityType: String? = nil,
        limit: Int = 20
    ) async throws -> GithubSearchResponseDTO {
        try await client.searchGithub(query: query, accountId: accountId, entityType: entityType, limit: limit)
    }

    public func sync(accountId: String) async throws -> GithubSyncResultDTO {
        try await client.syncGithubAccount(accountId: accountId)
    }

    public func createComment(input: GithubCommentCreateInput) async throws -> GithubCommentDTO {
        try await client.createGithubComment(input: input)
    }

    public func markNotificationRead(notificationId: String) async throws -> GithubNotificationDTO {
        try await client.markGithubNotificationRead(
            input: GithubNotificationMarkReadInput(notificationId: notificationId))
    }
}
