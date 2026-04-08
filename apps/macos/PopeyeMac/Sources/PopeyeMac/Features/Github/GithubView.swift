import SwiftUI
import PopeyeAPI

struct GithubView: View {
    @Bindable var store: GithubStore
    @Environment(AppModel.self) private var appModel

    var body: some View {
        Group {
            if store.loadPhase.isLoading && store.accounts.isEmpty {
                LoadingStateView(title: "Loading GitHub…")
            } else if let error = store.error, store.accounts.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else if store.accounts.isEmpty {
                noAccountState
            } else {
                content
            }
        }
        .navigationTitle("GitHub")
        .searchable(
            text: $store.searchText,
            placement: .toolbar,
            prompt: "Search GitHub issues and pull requests"
        )
        .toolbar {
            ToolbarItemGroup {
                Picker("Mode", selection: $store.mode) {
                    ForEach(GithubStore.Mode.allCases, id: \.self) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(minWidth: 300, idealWidth: 340, maxWidth: 420)

                if !store.accounts.isEmpty {
                    Picker("Account", selection: $store.selectedAccountID) {
                        ForEach(store.accounts) { account in
                            Text(account.githubUsername).tag(Optional(account.id))
                        }
                    }
                    .frame(width: 180)
                }

                Button("Search", systemImage: "magnifyingglass") {
                    Task { await store.search() }
                }
                .disabled(store.mode != .search || store.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button("Sync", systemImage: "arrow.clockwise") {
                    Task { await store.syncNow() }
                }
                .disabled(store.activeAccount == nil || store.mutationState == .executing)

                Button("Refresh", systemImage: "arrow.triangle.2.circlepath") {
                    Task { await store.load() }
                }
            }
        }
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onSubmit(of: .search) {
            guard store.mode == .search else { return }
            Task { await store.search() }
        }
        .onChange(of: store.selectedAccountID) { oldValue, newValue in
            guard oldValue != newValue, newValue != nil else { return }
            Task { await store.load() }
        }
        .onChange(of: store.mode) { _, _ in
            Task { await store.didChangeMode() }
        }
        .onChange(of: store.selectedPullRequestID) { oldValue, newValue in
            guard store.mode == .pullRequests, oldValue != newValue, newValue != nil else { return }
            Task { await store.loadSelectedPullRequest() }
        }
        .onChange(of: store.selectedIssueID) { oldValue, newValue in
            guard store.mode == .issues, oldValue != newValue, newValue != nil else { return }
            Task { await store.loadSelectedIssue() }
        }
        .onChange(of: store.selectedSearchResultID) { oldValue, newValue in
            guard store.mode == .search, oldValue != newValue, newValue != nil else { return }
            Task { await store.loadSelectedSearchResult() }
        }
        .popeyeRefreshable(invalidationSignals: [.connections, .general]) {
            await store.load()
        }
    }

    private var noAccountState: some View {
        ContentUnavailableView {
            Label("No GitHub account connected", systemImage: "chevron.left.forwardslash.chevron.right")
        } description: {
            Text("Connect GitHub from Connections or Setup, then return here for digest, review triage, and low-risk actions.")
        } actions: {
            Button("Open Connections") {
                appModel.navigateToConnection(id: nil)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private var content: some View {
        HSplitView {
            sidebar
                .popeyeSplitPane(minWidth: 280, idealWidth: 320, maxWidth: 360)

            detailPane
                .popeyeSplitPane(minWidth: 560)
        }
        .overlay(alignment: .bottomTrailing) {
            MutationStateOverlay(state: store.mutationState, dismiss: store.dismissMutation)
                .padding(20)
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Text(store.activeAccount?.displayName ?? store.activeAccount?.githubUsername ?? "GitHub")
                    .font(.headline)
                Text("Notifications, pull requests, issues, and repo health from the connected GitHub account.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                summaryCards
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)

            Divider()

            Group {
                switch store.mode {
                case .notifications:
                    if store.notifications.isEmpty {
                        EmptyStateView(icon: "bell", title: "No unread notifications", description: "Sync GitHub to refresh notification triage.")
                    } else {
                        List(store.notifications, selection: $store.selectedNotificationID) { notification in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(notification.subjectTitle)
                                    .font(.headline)
                                Text(notification.repoFullName)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                HStack {
                                    StatusBadge(state: notification.reason)
                                    if notification.isUnread {
                                        StatusBadge(state: "unread")
                                    }
                                }
                            }
                            .padding(.vertical, 4)
                            .tag(notification.id)
                        }
                        .listStyle(.sidebar)
                    }
                case .pullRequests:
                    if store.pullRequests.isEmpty {
                        EmptyStateView(icon: "arrow.triangle.pull", title: "No open pull requests", description: "Open or recently synced pull requests will appear here.")
                    } else {
                        List(store.pullRequests, selection: $store.selectedPullRequestID) { pullRequest in
                            GithubPullRequestRow(pullRequest: pullRequest, repoName: repoName(for: pullRequest.repoId))
                                .tag(pullRequest.id)
                        }
                        .listStyle(.sidebar)
                    }
                case .issues:
                    if store.issues.isEmpty {
                        EmptyStateView(icon: "exclamationmark.circle", title: "No open issues", description: "Assigned or synced issues will appear here.")
                    } else {
                        List(store.issues, selection: $store.selectedIssueID) { issue in
                            GithubIssueRow(issue: issue, repoName: repoName(for: issue.repoId))
                                .tag(issue.id)
                        }
                        .listStyle(.sidebar)
                    }
                case .repos:
                    if store.repos.isEmpty {
                        EmptyStateView(icon: "folder", title: "No repositories", description: "Run a sync to load repository metadata.")
                    } else {
                        List(store.repos, selection: $store.selectedRepoID) { repo in
                            GithubRepoRow(repo: repo)
                                .tag(repo.id)
                        }
                        .listStyle(.sidebar)
                    }
                case .search:
                    if store.searchResults.isEmpty {
                        EmptyStateView(icon: "magnifyingglass", title: "No search results", description: "Use the toolbar search field to query synced pull requests and issues.")
                    } else {
                        List(store.searchResults, selection: $store.selectedSearchResultID) { result in
                            GithubSearchResultRow(result: result)
                                .tag(result.id)
                        }
                        .listStyle(.sidebar)
                    }
                case .digest:
                    EmptyStateView(icon: "text.alignleft", title: "Digest loaded in detail", description: "Use Sync and Refresh to update the current GitHub digest.")
                }
            }
        }
    }

    private var detailPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                if let apiError = store.detailError ?? store.searchError {
                    Text(apiError.userMessage)
                        .font(.callout)
                        .foregroundStyle(.red)
                }

                switch store.mode {
                case .notifications:
                    notificationsDetail
                case .pullRequests:
                    pullRequestDetail
                case .issues:
                    issueDetail
                case .repos:
                    repoDetail
                case .search:
                    searchDetail
                case .digest:
                    digestDetail
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)
        }
    }

    private var summaryCards: some View {
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 12) {
            GridRow {
                summaryCard(label: "Repos", value: "\(store.repos.count)", detail: store.activeAccount?.repoCount.description ?? "0")
                summaryCard(label: "PRs", value: "\(store.pullRequests.count)", detail: "open")
            }
            GridRow {
                summaryCard(label: "Issues", value: "\(store.issues.count)", detail: "open")
                summaryCard(
                    label: "Unread",
                    value: "\(store.notifications.filter { $0.isUnread }.count)",
                    detail: store.activeAccount?.lastSyncAt.map(DateFormatting.formatRelativeTime) ?? "never"
                )
            }
        }
    }

    private func summaryCard(label: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.weight(.semibold))
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    private var notificationsDetail: some View {
        if let notification = store.selectedNotification {
            GroupBox("Notification") {
                VStack(alignment: .leading, spacing: 12) {
                    LabeledContent("Repository", value: notification.repoFullName)
                    LabeledContent("Reason", value: notification.reason)
                    LabeledContent("Type", value: notification.subjectType)
                    LabeledContent("Updated", value: DateFormatting.formatRelativeTime(notification.updatedAtGh))
                    HStack(spacing: 10) {
                        StatusBadge(state: notification.isUnread ? "unread" : "read")
                        Button(notification.isUnread ? "Mark Read" : "Already Read") {
                            Task { await store.markSelectedNotificationRead() }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!notification.isUnread || store.mutationState == .executing)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            EmptyStateView(icon: "bell", title: "Select a notification", description: "Unread notification details will appear here.")
                .frame(maxWidth: .infinity, minHeight: 360)
        }
    }

    @ViewBuilder
    private var pullRequestDetail: some View {
        if store.detailPhase.isLoading && store.pullRequestDetail == nil {
            LoadingStateView(title: "Loading pull request…")
        } else if let pullRequest = store.pullRequestDetail {
            GithubPullRequestDetail(pullRequest: pullRequest, repoName: repoName(for: pullRequest.repoId))
            commentComposer
        } else {
            EmptyStateView(icon: "arrow.triangle.pull", title: "Select a pull request", description: "Pull request detail, review state, and comment tools appear here.")
                .frame(maxWidth: .infinity, minHeight: 360)
        }
    }

    @ViewBuilder
    private var issueDetail: some View {
        if store.detailPhase.isLoading && store.issueDetail == nil {
            LoadingStateView(title: "Loading issue…")
        } else if let issue = store.issueDetail {
            GithubIssueDetail(issue: issue, repoName: repoName(for: issue.repoId))
            commentComposer
        } else {
            EmptyStateView(icon: "exclamationmark.circle", title: "Select an issue", description: "Issue detail and comment tools appear here.")
                .frame(maxWidth: .infinity, minHeight: 360)
        }
    }

    @ViewBuilder
    private var repoDetail: some View {
        if let repo = store.selectedRepo {
            GroupBox(repo.fullName) {
                VStack(alignment: .leading, spacing: 12) {
                    if !repo.description.isEmpty {
                        Text(repo.description)
                            .foregroundStyle(.secondary)
                    }
                    LabeledContent("Default branch", value: repo.defaultBranch)
                    LabeledContent("Language", value: repo.language ?? "—")
                    LabeledContent("Stars", value: "\(repo.starsCount)")
                    LabeledContent("Open issues", value: "\(repo.openIssuesCount)")
                    LabeledContent("Last pushed", value: repo.lastPushedAt.map(DateFormatting.formatRelativeTime) ?? "never")
                    HStack(spacing: 10) {
                        StatusBadge(state: repo.isPrivate ? "private" : "public")
                        if repo.isFork {
                            StatusBadge(state: "fork")
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            EmptyStateView(icon: "folder", title: "Select a repository", description: "Repository metadata appears here.")
                .frame(maxWidth: .infinity, minHeight: 360)
        }
    }

    @ViewBuilder
    private var searchDetail: some View {
        if store.searchPhase.isLoading && store.searchResults.isEmpty {
            LoadingStateView(title: "Searching GitHub…")
        } else if let result = store.selectedSearchResult {
            GroupBox("Search Match") {
                VStack(alignment: .leading, spacing: 12) {
                    LabeledContent("Repository", value: result.repoFullName)
                    LabeledContent("Type", value: result.entityType.uppercased())
                    LabeledContent("State", value: result.state)
                    LabeledContent("Updated", value: DateFormatting.formatRelativeTime(result.updatedAt))
                    LabeledContent("Score", value: String(format: "%.2f", result.score))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if result.entityType == "pr", let pullRequest = store.pullRequestDetail {
                GithubPullRequestDetail(pullRequest: pullRequest, repoName: result.repoFullName)
                commentComposer
            } else if let issue = store.issueDetail {
                GithubIssueDetail(issue: issue, repoName: result.repoFullName)
                commentComposer
            }
        } else {
            EmptyStateView(icon: "magnifyingglass", title: "Search synced GitHub data", description: "Use the toolbar search field to find issues and pull requests.")
                .frame(maxWidth: .infinity, minHeight: 360)
        }
    }

    @ViewBuilder
    private var digestDetail: some View {
        if let digest = store.digest {
            GroupBox("Daily Digest") {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        StatusBadge(state: "\(digest.openPrsCount) prs")
                        StatusBadge(state: "\(digest.reviewRequestsCount) reviews")
                        StatusBadge(state: "\(digest.assignedIssuesCount) assigned")
                        StatusBadge(state: "\(digest.unreadNotificationsCount) unread")
                    }
                    MarkdownPreviewView(markdown: digest.summaryMarkdown)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            EmptyStateView(icon: "text.alignleft", title: "No digest yet", description: "Sync GitHub to generate and load a digest.")
                .frame(maxWidth: .infinity, minHeight: 360)
        }
    }

    @ViewBuilder
    private var commentComposer: some View {
        GroupBox("Comment") {
            VStack(alignment: .leading, spacing: 12) {
                Text("Low-risk comments only. Popeye still enforces the existing approval and allowlist policy at the API boundary.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                TextEditor(text: $store.commentDraft)
                    .font(.body)
                    .frame(minHeight: 120)
                    .padding(8)
                    .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
                HStack {
                    Button("Post Comment") {
                        Task { await store.createCommentOnSelectedItem() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!store.canComment || store.mutationState == .executing)

                    if let comment = store.lastComment {
                        Text("Last posted \(DateFormatting.formatRelativeTime(comment.createdAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func repoName(for repoID: String) -> String {
        store.repos.first(where: { $0.id == repoID })?.fullName ?? repoID
    }

    private func reload() {
        Task { await store.load() }
    }
}

private struct GithubPullRequestRow: View {
    let pullRequest: GithubPullRequestDTO
    let repoName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(pullRequest.title)
                .font(.headline)
            Text("\(repoName) · #\(pullRequest.githubPrNumber)")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                StatusBadge(state: pullRequest.state)
                if let reviewDecision = pullRequest.reviewDecision {
                    StatusBadge(state: reviewDecision)
                }
                if let ciStatus = pullRequest.ciStatus {
                    StatusBadge(state: ciStatus)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct GithubIssueRow: View {
    let issue: GithubIssueDTO
    let repoName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(issue.title)
                .font(.headline)
            Text("\(repoName) · #\(issue.githubIssueNumber)")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                StatusBadge(state: issue.state)
                if issue.isAssignedToMe {
                    StatusBadge(state: "assigned")
                }
                if issue.isMentioned {
                    StatusBadge(state: "mentioned")
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct GithubRepoRow: View {
    let repo: GithubRepoDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(repo.fullName)
                .font(.headline)
            if !repo.description.isEmpty {
                Text(repo.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            HStack(spacing: 8) {
                if let language = repo.language {
                    StatusBadge(state: language)
                }
                StatusBadge(state: repo.isPrivate ? "private" : "public")
            }
        }
        .padding(.vertical, 4)
    }
}

private struct GithubSearchResultRow: View {
    let result: GithubSearchResultDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(result.title)
                .font(.headline)
            Text("\(result.repoFullName) · \(result.entityType.uppercased()) #\(result.number)")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                StatusBadge(state: result.state)
                Text(String(format: "Score %.2f", result.score))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct GithubPullRequestDetail: View {
    let pullRequest: GithubPullRequestDTO
    let repoName: String

    var body: some View {
        GroupBox(pullRequest.title) {
            VStack(alignment: .leading, spacing: 12) {
                LabeledContent("Repository", value: repoName)
                LabeledContent("Author", value: pullRequest.author)
                LabeledContent("Branches", value: "\(pullRequest.headBranch) → \(pullRequest.baseBranch)")
                LabeledContent("Diff", value: "+\(pullRequest.additions) / -\(pullRequest.deletions) · \(pullRequest.changedFiles) files")
                HStack(spacing: 10) {
                    StatusBadge(state: pullRequest.state)
                    if pullRequest.isDraft {
                        StatusBadge(state: "draft")
                    }
                    if let reviewDecision = pullRequest.reviewDecision {
                        StatusBadge(state: reviewDecision)
                    }
                    if let ciStatus = pullRequest.ciStatus {
                        StatusBadge(state: ciStatus)
                    }
                }
                if !pullRequest.labels.isEmpty {
                    Text(pullRequest.labels.joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if !pullRequest.bodyPreview.isEmpty {
                    Text(pullRequest.bodyPreview)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct GithubIssueDetail: View {
    let issue: GithubIssueDTO
    let repoName: String

    var body: some View {
        GroupBox(issue.title) {
            VStack(alignment: .leading, spacing: 12) {
                LabeledContent("Repository", value: repoName)
                LabeledContent("Author", value: issue.author)
                LabeledContent("State", value: issue.state)
                LabeledContent("Milestone", value: issue.milestone ?? "—")
                if !issue.assignees.isEmpty {
                    LabeledContent("Assignees", value: issue.assignees.joined(separator: ", "))
                }
                if !issue.labels.isEmpty {
                    LabeledContent("Labels", value: issue.labels.joined(separator: ", "))
                }
                HStack(spacing: 10) {
                    if issue.isAssignedToMe {
                        StatusBadge(state: "assigned")
                    }
                    if issue.isMentioned {
                        StatusBadge(state: "mentioned")
                    }
                }
                if !issue.bodyPreview.isEmpty {
                    Text(issue.bodyPreview)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
