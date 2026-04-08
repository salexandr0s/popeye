import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class GithubStore {
    enum Mode: String, CaseIterable {
        case notifications
        case pullRequests
        case issues
        case repos
        case search
        case digest

        var title: String {
            switch self {
            case .notifications: "Notifications"
            case .pullRequests: "PRs"
            case .issues: "Issues"
            case .repos: "Repos"
            case .search: "Search"
            case .digest: "Digest"
            }
        }
    }

    struct Dependencies: Sendable {
        var loadAccounts: @Sendable () async throws -> [GithubAccountDTO]
        var loadRepos: @Sendable (_ accountId: String) async throws -> [GithubRepoDTO]
        var loadPullRequests: @Sendable (_ accountId: String) async throws -> [GithubPullRequestDTO]
        var loadPullRequest: @Sendable (_ id: String) async throws -> GithubPullRequestDTO
        var loadIssues: @Sendable (_ accountId: String) async throws -> [GithubIssueDTO]
        var loadIssue: @Sendable (_ id: String) async throws -> GithubIssueDTO
        var loadNotifications: @Sendable (_ accountId: String) async throws -> [GithubNotificationDTO]
        var loadDigest: @Sendable (_ accountId: String) async throws -> GithubDigestDTO?
        var search: @Sendable (_ query: String, _ accountId: String) async throws -> GithubSearchResponseDTO
        var sync: @Sendable (_ accountId: String) async throws -> GithubSyncResultDTO
        var createComment: @Sendable (_ input: GithubCommentCreateInput) async throws -> GithubCommentDTO
        var markNotificationRead: @Sendable (_ notificationId: String) async throws -> GithubNotificationDTO

        static func live(client: ControlAPIClient) -> Dependencies {
            let service = GithubService(client: client)
            return Dependencies(
                loadAccounts: { try await service.loadAccounts() },
                loadRepos: { accountId in try await service.loadRepos(accountId: accountId) },
                loadPullRequests: { accountId in try await service.loadPullRequests(accountId: accountId) },
                loadPullRequest: { id in try await service.loadPullRequest(id: id) },
                loadIssues: { accountId in try await service.loadIssues(accountId: accountId) },
                loadIssue: { id in try await service.loadIssue(id: id) },
                loadNotifications: { accountId in try await service.loadNotifications(accountId: accountId) },
                loadDigest: { accountId in try await service.loadDigest(accountId: accountId) },
                search: { query, accountId in try await service.search(query: query, accountId: accountId) },
                sync: { accountId in try await service.sync(accountId: accountId) },
                createComment: { input in try await service.createComment(input: input) },
                markNotificationRead: { notificationId in try await service.markNotificationRead(notificationId: notificationId) }
            )
        }
    }

    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            resetSelection()
        }
    }

    var mode: Mode = .notifications
    var searchText = ""
    var commentDraft = ""

    var accounts: [GithubAccountDTO] = []
    var repos: [GithubRepoDTO] = []
    var pullRequests: [GithubPullRequestDTO] = []
    var issues: [GithubIssueDTO] = []
    var notifications: [GithubNotificationDTO] = []
    var searchResults: [GithubSearchResultDTO] = []
    var digest: GithubDigestDTO?
    var lastComment: GithubCommentDTO?
    var lastSyncResult: GithubSyncResultDTO?

    var selectedAccountID: String?
    var selectedRepoID: String?
    var selectedPullRequestID: String?
    var selectedIssueID: String?
    var selectedNotificationID: String?
    var selectedSearchResultID: String?

    var pullRequestDetail: GithubPullRequestDTO?
    var issueDetail: GithubIssueDTO?

    var loadPhase: ScreenLoadPhase = .idle
    var detailPhase: ScreenOperationPhase = .idle
    var searchPhase: ScreenOperationPhase = .idle

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let dependencies: Dependencies

    init(client: ControlAPIClient) {
        self.dependencies = .live(client: client)
    }

    init(dependencies: Dependencies) {
        self.dependencies = dependencies
    }

    var error: APIError? { loadPhase.error }
    var detailError: APIError? { detailPhase.error }
    var searchError: APIError? { searchPhase.error }

    var activeAccount: GithubAccountDTO? {
        accounts.first(where: { $0.id == selectedAccountID }) ?? accounts.first
    }

    var selectedRepo: GithubRepoDTO? {
        guard let selectedRepoID else { return nil }
        return repos.first(where: { $0.id == selectedRepoID })
    }

    var selectedNotification: GithubNotificationDTO? {
        guard let selectedNotificationID else { return nil }
        return notifications.first(where: { $0.id == selectedNotificationID })
    }

    var selectedSearchResult: GithubSearchResultDTO? {
        guard let selectedSearchResultID else { return nil }
        return searchResults.first(where: { $0.id == selectedSearchResultID })
    }

    var selectedCommentTarget: (repoFullName: String, issueNumber: Int)? {
        if let pullRequestDetail,
           let repo = repos.first(where: { $0.id == pullRequestDetail.repoId }) {
            return (repo.fullName, pullRequestDetail.githubPrNumber)
        }
        if let issueDetail,
           let repo = repos.first(where: { $0.id == issueDetail.repoId }) {
            return (repo.fullName, issueDetail.githubIssueNumber)
        }
        return nil
    }

    var canComment: Bool {
        selectedCommentTarget != nil
            && activeAccount != nil
            && !commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func load() async {
        loadPhase = .loading
        detailPhase = .idle
        searchPhase = .idle

        do {
            accounts = try await dependencies.loadAccounts()
            if selectedAccountID == nil || accounts.contains(where: { $0.id == selectedAccountID }) == false {
                selectedAccountID = accounts.first?.id
            }

            guard let selectedAccountID else {
                repos = []
                pullRequests = []
                issues = []
                notifications = []
                searchResults = []
                digest = nil
                pullRequestDetail = nil
                issueDetail = nil
                loadPhase = .empty
                return
            }

            async let reposTask = dependencies.loadRepos(selectedAccountID)
            async let pullRequestsTask = dependencies.loadPullRequests(selectedAccountID)
            async let issuesTask = dependencies.loadIssues(selectedAccountID)
            async let notificationsTask = dependencies.loadNotifications(selectedAccountID)
            async let digestTask = dependencies.loadDigest(selectedAccountID)

            let (loadedRepos, loadedPullRequests, loadedIssues, loadedNotifications, loadedDigest) = try await (
                reposTask,
                pullRequestsTask,
                issuesTask,
                notificationsTask,
                digestTask
            )

            repos = loadedRepos
            pullRequests = loadedPullRequests
            issues = loadedIssues
            notifications = loadedNotifications
            digest = loadedDigest
            synchronizeSelection()
            loadPhase = .loaded
            await refreshCurrentDetail()
        } catch {
            loadPhase = .failed(APIError.from(error))
        }
    }

    func didChangeMode() async {
        synchronizeSelection()
        await refreshCurrentDetail()
    }

    func loadSelectedPullRequest() async {
        guard let selectedPullRequestID else {
            pullRequestDetail = nil
            return
        }
        detailPhase = .loading
        do {
            pullRequestDetail = try await dependencies.loadPullRequest(selectedPullRequestID)
            detailPhase = .idle
        } catch {
            detailPhase = .failed(APIError.from(error))
        }
    }

    func loadSelectedIssue() async {
        guard let selectedIssueID else {
            issueDetail = nil
            return
        }
        detailPhase = .loading
        do {
            issueDetail = try await dependencies.loadIssue(selectedIssueID)
            detailPhase = .idle
        } catch {
            detailPhase = .failed(APIError.from(error))
        }
    }

    func loadSelectedSearchResult() async {
        guard let selectedSearchResult else {
            pullRequestDetail = nil
            issueDetail = nil
            detailPhase = .idle
            return
        }

        switch selectedSearchResult.entityType {
        case "pr":
            selectedPullRequestID = selectedSearchResult.entityId
            await loadSelectedPullRequest()
        default:
            selectedIssueID = selectedSearchResult.entityId
            await loadSelectedIssue()
        }
    }

    func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let account = activeAccount, !query.isEmpty else {
            searchResults = []
            selectedSearchResultID = nil
            searchPhase = .idle
            return
        }

        searchPhase = .loading
        do {
            let response = try await dependencies.search(query, account.id)
            searchResults = response.results
            selectedSearchResultID = searchResults.first?.id
            searchPhase = .idle
            await loadSelectedSearchResult()
        } catch {
            searchPhase = .failed(APIError.from(error))
        }
    }

    func syncNow() async {
        guard let account = activeAccount else { return }
        await mutations.execute(
            action: {
                self.lastSyncResult = try await self.dependencies.sync(account.id)
            },
            successMessage: "GitHub synced",
            fallbackError: "GitHub sync failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func markSelectedNotificationRead() async {
        guard let selectedNotificationID else { return }
        await mutations.execute(
            action: {
                let updated = try await self.dependencies.markNotificationRead(selectedNotificationID)
                if let index = self.notifications.firstIndex(where: { $0.id == updated.id }) {
                    self.notifications[index] = updated
                }
            },
            successMessage: "Notification marked read",
            fallbackError: "Mark read failed"
        )
    }

    func createCommentOnSelectedItem() async {
        guard let account = activeAccount,
              let target = selectedCommentTarget
        else { return }

        let body = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }

        await mutations.execute(
            action: {
                self.lastComment = try await self.dependencies.createComment(
                    GithubCommentCreateInput(
                        accountId: account.id,
                        repoFullName: target.repoFullName,
                        issueNumber: target.issueNumber,
                        body: body
                    )
                )
                self.commentDraft = ""
            },
            successMessage: "GitHub comment posted",
            fallbackError: "GitHub comment failed"
        )
    }

    func dismissMutation() {
        mutations.dismiss()
    }

    private func synchronizeSelection() {
        switch mode {
        case .notifications:
            if notifications.contains(where: { $0.id == selectedNotificationID }) == false {
                selectedNotificationID = notifications.first?.id
            }
        case .pullRequests:
            if pullRequests.contains(where: { $0.id == selectedPullRequestID }) == false {
                selectedPullRequestID = pullRequests.first?.id
            }
        case .issues:
            if issues.contains(where: { $0.id == selectedIssueID }) == false {
                selectedIssueID = issues.first?.id
            }
        case .repos:
            if repos.contains(where: { $0.id == selectedRepoID }) == false {
                selectedRepoID = repos.first?.id
            }
        case .search:
            if searchResults.contains(where: { $0.id == selectedSearchResultID }) == false {
                selectedSearchResultID = searchResults.first?.id
            }
        case .digest:
            break
        }
    }

    private func refreshCurrentDetail() async {
        switch mode {
        case .pullRequests:
            await loadSelectedPullRequest()
        case .issues:
            await loadSelectedIssue()
        case .search:
            await loadSelectedSearchResult()
        default:
            detailPhase = .idle
        }
    }

    private func resetSelection() {
        repos = []
        pullRequests = []
        issues = []
        notifications = []
        searchResults = []
        digest = nil
        selectedAccountID = nil
        selectedRepoID = nil
        selectedPullRequestID = nil
        selectedIssueID = nil
        selectedNotificationID = nil
        selectedSearchResultID = nil
        pullRequestDetail = nil
        issueDetail = nil
        lastComment = nil
        lastSyncResult = nil
        commentDraft = ""
        loadPhase = .idle
        detailPhase = .idle
        searchPhase = .idle
        mutations.dismiss()
    }
}
