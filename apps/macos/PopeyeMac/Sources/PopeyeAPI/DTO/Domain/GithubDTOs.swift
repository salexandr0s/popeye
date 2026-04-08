import Foundation

public struct GithubAccountDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let connectionId: String
    public let githubUsername: String
    public let displayName: String
    public let syncCursorSince: String?
    public let lastSyncAt: String?
    public let repoCount: Int
    public let createdAt: String
    public let updatedAt: String
}

public struct GithubRepoDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let githubRepoId: Int
    public let owner: String
    public let name: String
    public let fullName: String
    public let description: String
    public let isPrivate: Bool
    public let isFork: Bool
    public let defaultBranch: String
    public let language: String?
    public let starsCount: Int
    public let openIssuesCount: Int
    public let lastPushedAt: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct GithubPullRequestDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let repoId: String
    public let githubPrNumber: Int
    public let title: String
    public let bodyPreview: String
    public let author: String
    public let state: String
    public let isDraft: Bool
    public let reviewDecision: String?
    public let ciStatus: String?
    public let headBranch: String
    public let baseBranch: String
    public let additions: Int
    public let deletions: Int
    public let changedFiles: Int
    public let labels: [String]
    public let requestedReviewers: [String]
    public let createdAtGh: String
    public let updatedAtGh: String
    public let mergedAt: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct GithubIssueDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let repoId: String
    public let githubIssueNumber: Int
    public let title: String
    public let bodyPreview: String
    public let author: String
    public let state: String
    public let labels: [String]
    public let assignees: [String]
    public let milestone: String?
    public let isAssignedToMe: Bool
    public let isMentioned: Bool
    public let createdAtGh: String
    public let updatedAtGh: String
    public let closedAt: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct GithubNotificationDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let githubNotificationId: String
    public let repoFullName: String
    public let subjectTitle: String
    public let subjectType: String
    public let reason: String
    public let isUnread: Bool
    public let updatedAtGh: String
    public let createdAt: String
    public let updatedAt: String
}

public struct GithubDigestDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let workspaceId: String
    public let date: String
    public let openPrsCount: Int
    public let reviewRequestsCount: Int
    public let assignedIssuesCount: Int
    public let unreadNotificationsCount: Int
    public let summaryMarkdown: String
    public let generatedAt: String
}

public struct GithubSearchResultDTO: Codable, Sendable, Equatable, Identifiable {
    public var id: String { entityId }

    public let entityType: String
    public let entityId: String
    public let repoFullName: String
    public let number: Int
    public let title: String
    public let author: String
    public let state: String
    public let updatedAt: String
    public let score: Double
}

public struct GithubSearchResponseDTO: Codable, Sendable, Equatable {
    public let query: String
    public let results: [GithubSearchResultDTO]
}

public struct GithubSyncResultDTO: Codable, Sendable, Equatable {
    public let accountId: String
    public let reposSynced: Int
    public let prsSynced: Int
    public let issuesSynced: Int
    public let notificationsSynced: Int
    public let errors: [String]
}

public struct GithubCommentDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let repoFullName: String
    public let issueNumber: Int
    public let bodyPreview: String
    public let htmlUrl: String?
    public let createdAt: String
}

public struct GithubCommentCreateInput: Encodable, Sendable, Equatable {
    public let accountId: String
    public let repoFullName: String
    public let issueNumber: Int
    public let body: String

    public init(accountId: String, repoFullName: String, issueNumber: Int, body: String) {
        self.accountId = accountId
        self.repoFullName = repoFullName
        self.issueNumber = issueNumber
        self.body = body
    }
}

public struct GithubNotificationMarkReadInput: Encodable, Sendable, Equatable {
    public let notificationId: String

    public init(notificationId: String) {
        self.notificationId = notificationId
    }
}
