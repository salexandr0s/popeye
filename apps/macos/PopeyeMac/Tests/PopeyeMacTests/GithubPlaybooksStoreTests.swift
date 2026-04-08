import Foundation
import Testing

@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("GitHub Store")
struct GithubStoreTests {
    @Test("Load selects the default account and hydrates pull-request detail")
    func loadHydratesPullRequestDetail() async {
        let store = GithubStore(dependencies: .stub())
        store.mode = .pullRequests

        await store.load()

        #expect(store.loadPhase == .loaded)
        #expect(store.selectedAccountID == "gh-account-1")
        #expect(store.selectedPullRequestID == "gh-pr-1")
        #expect(store.pullRequestDetail?.id == "gh-pr-1")
    }

    @Test("Search loads results and selected search detail")
    func searchHydratesSelectedResult() async {
        let store = GithubStore(dependencies: .stub())

        await store.load()
        store.mode = .search
        store.searchText = "compiler"
        await store.search()

        #expect(store.searchPhase == .idle)
        #expect(store.searchResults.count == 1)
        #expect(store.selectedSearchResultID == "gh-pr-1")
        #expect(store.pullRequestDetail?.id == "gh-pr-1")
    }

    @Test("Mark read and comment mutations update local state")
    func markReadAndComment() async {
        let store = GithubStore(dependencies: .stub())

        await store.load()
        await store.markSelectedNotificationRead()
        #expect(store.notifications.first?.isUnread == false)
        #expect(store.mutationState == .succeeded("Notification marked read"))

        store.mode = .issues
        await store.didChangeMode()
        store.commentDraft = "Looks good to me."
        await store.createCommentOnSelectedItem()

        #expect(store.lastComment?.repoFullName == "nb/popeye")
        #expect(store.commentDraft.isEmpty)
        #expect(store.mutationState == .succeeded("GitHub comment posted"))
    }
}

@MainActor
@Suite("Playbooks Store")
struct PlaybooksStoreTests {
    @Test("Load hydrates the selected playbook detail")
    func loadHydratesPlaybookDetail() async {
        let store = PlaybooksStore(dependencies: .stub())

        await store.load()

        #expect(store.loadPhase == .loaded)
        #expect(store.selectedPlaybookRecordID == "workspace:default:triage")
        #expect(store.selectedPlaybookDetail?.recordId == "workspace:default:triage")
        #expect(store.revisions.count == 1)
        #expect(store.usage.count == 1)
    }

    @Test("Reveal applied playbook selects the matching canonical record")
    func revealAppliedPlaybook() async {
        let store = PlaybooksStore(dependencies: .stub())

        await store.revealAppliedPlaybook(id: "triage", scope: "workspace")

        #expect(store.mode == .playbooks)
        #expect(store.playbookScopeFilter == "workspace")
        #expect(store.selectedPlaybookRecordID == "workspace:default:triage")
        #expect(store.selectedPlaybookDetail?.playbookId == "triage")
    }

    @Test("New draft authoring creates a drafting proposal and switches to proposals")
    func createDraftAuthoringFlow() async {
        let draftingProposal = samplePlaybookProposal(kind: "draft", status: "drafting", targetRecordId: nil, playbookId: "inbox-triage", title: "Inbox triage", body: "# Inbox triage\n\nFollow the inbox checklist.", summary: "Created in native authoring")
        let store = PlaybooksStore(dependencies: .stub(
            loadProposals: { _, _, _, _, _, _, _ in [draftingProposal] },
            loadProposal: { _ in draftingProposal },
            createDraftProposal: { _ in draftingProposal }
        ))

        await store.load()
        store.startNewDraftAuthoring()
        store.updateEditorPlaybookID("inbox-triage")
        store.updateEditorTitle("Inbox triage")
        store.updateEditorSummary("Created in native authoring")
        store.updateEditorBody("# Inbox triage\n\nFollow the inbox checklist.")
        await store.saveAuthoringDraft()

        #expect(store.mode == .proposals)
        #expect(store.selectedProposalID == "proposal-1")
        #expect(store.selectedProposalDetail?.status == "drafting")
        #expect(store.editor?.proposalID == "proposal-1")
        #expect(store.mutationState == .succeeded("Playbook draft created"))
    }

    @Test("Submitting authoring draft persists and submits for review")
    func submitDraftAuthoringFlow() async {
        let submittedProposal = samplePlaybookProposal(id: "proposal-1", kind: "draft", status: "pending_review", targetRecordId: nil, playbookId: "triage-v2", title: "Triage v2", body: "Updated authoring body")
        let store = PlaybooksStore(dependencies: .stub(
            loadProposals: { _, _, _, _, _, _, _ in [submittedProposal] },
            loadProposal: { _ in submittedProposal },
            createDraftProposal: { input in
                samplePlaybookProposal(id: "proposal-1", kind: "draft", status: "drafting", targetRecordId: nil, playbookId: input.playbookId, title: input.title, body: input.body, summary: input.summary, allowedProfileIds: input.allowedProfileIds)
            },
            submitProposalForReview: { _, _ in submittedProposal }
        ))

        await store.load()
        store.startNewDraftAuthoring()
        store.updateEditorPlaybookID("triage-v2")
        store.updateEditorTitle("Triage v2")
        store.updateEditorBody("Updated authoring body")
        await store.submitAuthoringDraftForReview()

        #expect(store.mode == .proposals)
        #expect(store.selectedProposalDetail?.status == "pending_review")
        #expect(store.editor == nil)
        #expect(store.mutationState == .succeeded("Playbook proposal submitted"))
    }

    @Test("Suggest patch opens the returned drafting proposal in the editor")
    func suggestPatchSeedsEditor() async {
        let suggested = samplePlaybookProposal(id: "proposal-2", kind: "patch", status: "drafting")
        let store = PlaybooksStore(dependencies: .stub(
            loadProposals: { _, _, _, _, _, _, _ in [suggested] },
            loadProposal: { _ in suggested },
            suggestPatch: { _, _ in suggested }
        ))

        await store.load()
        await store.suggestPatchForSelectedPlaybook()

        #expect(store.mode == .proposals)
        #expect(store.selectedProposalID == "proposal-2")
        #expect(store.selectedProposalDetail?.status == "drafting")
        #expect(store.editor?.proposalID == "proposal-2")
        #expect(store.editor?.kind == "patch")
    }

    @Test("Editing selected drafting proposal loads the draft into the editor")
    func editSelectedDraft() async {
        let store = PlaybooksStore(dependencies: .stub(
            loadProposals: { _, _, _, _, _, _, _ in
                [samplePlaybookProposal(id: "proposal-3", kind: "draft", status: "drafting", targetRecordId: nil)]
            },
            loadProposal: { _ in
                samplePlaybookProposal(id: "proposal-3", kind: "draft", status: "drafting", targetRecordId: nil)
            }
        ))
        store.mode = .proposals

        await store.load()
        store.editSelectedDraft()

        #expect(store.editor?.proposalID == "proposal-3")
        #expect(store.editor?.kind == "draft")
        #expect(store.editor?.playbookId == "triage")
    }

    @Test("Apply proposal switches back to playbooks and loads applied detail")
    func applyProposalTransitionsToCanonicalRecord() async {
        let store = PlaybooksStore(dependencies: .stub())
        store.mode = .proposals

        await store.load()
        await store.applySelectedProposal()

        #expect(store.mode == .playbooks)
        #expect(store.selectedPlaybookRecordID == "workspace:default:triage")
        #expect(store.selectedPlaybookDetail?.recordId == "workspace:default:triage")
        #expect(store.mutationState == .succeeded("Playbook proposal applied"))
    }
}

extension GithubStore.Dependencies {
    fileprivate static func stub(
        loadAccounts: @Sendable @escaping () async throws -> [GithubAccountDTO] = {
            [sampleGithubAccount()]
        },
        loadRepos: @Sendable @escaping (_ accountId: String) async throws -> [GithubRepoDTO] = { _ in
            [sampleGithubRepo()]
        },
        loadPullRequests: @Sendable @escaping (_ accountId: String) async throws -> [GithubPullRequestDTO] = { _ in
            [sampleGithubPullRequest()]
        },
        loadPullRequest: @Sendable @escaping (_ id: String) async throws -> GithubPullRequestDTO = { _ in
            sampleGithubPullRequest()
        },
        loadIssues: @Sendable @escaping (_ accountId: String) async throws -> [GithubIssueDTO] = { _ in
            [sampleGithubIssue()]
        },
        loadIssue: @Sendable @escaping (_ id: String) async throws -> GithubIssueDTO = { _ in
            sampleGithubIssue()
        },
        loadNotifications: @Sendable @escaping (_ accountId: String) async throws -> [GithubNotificationDTO] = { _ in
            [sampleGithubNotification()]
        },
        loadDigest: @Sendable @escaping (_ accountId: String) async throws -> GithubDigestDTO? = { _ in
            sampleGithubDigest()
        },
        search: @Sendable @escaping (_ query: String, _ accountId: String) async throws -> GithubSearchResponseDTO = { query, _ in
            GithubSearchResponseDTO(query: query, results: [sampleGithubSearchResult()])
        },
        sync: @Sendable @escaping (_ accountId: String) async throws -> GithubSyncResultDTO = { accountId in
            GithubSyncResultDTO(accountId: accountId, reposSynced: 1, prsSynced: 1, issuesSynced: 1, notificationsSynced: 1, errors: [])
        },
        createComment: @Sendable @escaping (_ input: GithubCommentCreateInput) async throws -> GithubCommentDTO = { input in
            GithubCommentDTO(
                id: "gh-comment-1",
                accountId: input.accountId,
                repoFullName: input.repoFullName,
                issueNumber: input.issueNumber,
                bodyPreview: input.body,
                htmlUrl: nil,
                createdAt: "2026-04-08T09:00:00Z"
            )
        },
        markNotificationRead: @Sendable @escaping (_ notificationId: String) async throws -> GithubNotificationDTO = { _ in
            GithubNotificationDTO(
                id: "gh-notification-1",
                accountId: "gh-account-1",
                githubNotificationId: "github-notification-1",
                repoFullName: "nb/popeye",
                subjectTitle: "Review compiler indexing",
                subjectType: "PullRequest",
                reason: "review_requested",
                isUnread: false,
                updatedAtGh: "2026-04-08T08:00:00Z",
                createdAt: "2026-04-08T08:00:00Z",
                updatedAt: "2026-04-08T09:00:00Z"
            )
        }
    ) -> Self {
        Self(
            loadAccounts: loadAccounts,
            loadRepos: loadRepos,
            loadPullRequests: loadPullRequests,
            loadPullRequest: loadPullRequest,
            loadIssues: loadIssues,
            loadIssue: loadIssue,
            loadNotifications: loadNotifications,
            loadDigest: loadDigest,
            search: search,
            sync: sync,
            createComment: createComment,
            markNotificationRead: markNotificationRead
        )
    }
}

extension PlaybooksStore.Dependencies {
    fileprivate static func stub(
        loadPlaybooks: @Sendable @escaping (_ query: String?, _ scope: String?, _ workspaceId: String, _ status: String?, _ limit: Int, _ offset: Int) async throws -> [PlaybookRecordDTO] = { _, _, _, _, _, _ in
            [samplePlaybookRecord()]
        },
        loadPlaybook: @Sendable @escaping (_ id: String) async throws -> PlaybookDetailDTO = { _ in
            samplePlaybookDetail()
        },
        loadRevisions: @Sendable @escaping (_ id: String) async throws -> [PlaybookRevisionDTO] = { _ in
            [samplePlaybookRevision()]
        },
        loadUsage: @Sendable @escaping (_ id: String, _ limit: Int, _ offset: Int) async throws -> [PlaybookUsageRunDTO] = { _, _, _ in
            [samplePlaybookUsage()]
        },
        loadStaleCandidates: @Sendable @escaping () async throws -> [PlaybookStaleCandidateDTO] = {
            [samplePlaybookStaleCandidate()]
        },
        loadProposals: @Sendable @escaping (_ query: String?, _ status: String?, _ kind: String?, _ scope: String?, _ sort: String?, _ limit: Int, _ offset: Int) async throws -> [PlaybookProposalDTO] = { _, _, _, _, _, _, _ in
            [samplePlaybookProposal(status: "approved")]
        },
        loadProposal: @Sendable @escaping (_ id: String) async throws -> PlaybookProposalDTO = { _ in
            samplePlaybookProposal(status: "approved")
        },
        loadWorkspaces: @Sendable @escaping () async throws -> [WorkspaceRecordDTO] = {
            [sampleWorkspace()]
        },
        loadProjects: @Sendable @escaping () async throws -> [ProjectRecordDTO] = {
            [sampleProject()]
        },
        createDraftProposal: @Sendable @escaping (_ input: PlaybookProposalCreateDraftInput) async throws -> PlaybookProposalDTO = { input in
            samplePlaybookProposal(
                kind: "draft",
                status: "drafting",
                targetRecordId: nil,
                playbookId: input.playbookId,
                scope: input.scope,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                title: input.title,
                body: input.body,
                summary: input.summary,
                allowedProfileIds: input.allowedProfileIds
            )
        },
        createPatchProposal: @Sendable @escaping (_ input: PlaybookProposalCreatePatchInput) async throws -> PlaybookProposalDTO = { input in
            samplePlaybookProposal(
                kind: "patch",
                status: "drafting",
                targetRecordId: input.targetRecordId,
                title: input.title,
                body: input.body,
                summary: input.summary,
                allowedProfileIds: input.allowedProfileIds
            )
        },
        updateProposal: @Sendable @escaping (_ id: String, _ input: PlaybookProposalUpdateInput) async throws -> PlaybookProposalDTO = { id, input in
            samplePlaybookProposal(
                id: id,
                kind: "draft",
                status: "drafting",
                targetRecordId: nil,
                title: input.title,
                body: input.body,
                summary: input.summary,
                allowedProfileIds: input.allowedProfileIds
            )
        },
        suggestPatch: @Sendable @escaping (_ id: String, _ proposedBy: String) async throws -> PlaybookProposalDTO = { _, _ in
            samplePlaybookProposal(id: "proposal-2", kind: "patch", status: "drafting")
        },
        reviewProposal: @Sendable @escaping (_ id: String, _ decision: String, _ reviewedBy: String) async throws -> PlaybookProposalDTO = { _, decision, _ in
            samplePlaybookProposal(status: decision)
        },
        submitProposalForReview: @Sendable @escaping (_ id: String, _ submittedBy: String) async throws -> PlaybookProposalDTO = { _, _ in
            samplePlaybookProposal(status: "pending_review")
        },
        applyProposal: @Sendable @escaping (_ id: String, _ appliedBy: String) async throws -> PlaybookProposalDTO = { _, _ in
            samplePlaybookProposal(status: "applied", appliedRecordId: "workspace:default:triage")
        },
        activatePlaybook: @Sendable @escaping (_ id: String, _ updatedBy: String) async throws -> PlaybookDetailDTO = { _, _ in
            samplePlaybookDetail(status: "active")
        },
        retirePlaybook: @Sendable @escaping (_ id: String, _ updatedBy: String) async throws -> PlaybookDetailDTO = { _, _ in
            samplePlaybookDetail(status: "retired")
        }
    ) -> Self {
        Self(
            loadPlaybooks: loadPlaybooks,
            loadPlaybook: loadPlaybook,
            loadRevisions: loadRevisions,
            loadUsage: loadUsage,
            loadStaleCandidates: loadStaleCandidates,
            loadProposals: loadProposals,
            loadProposal: loadProposal,
            loadWorkspaces: loadWorkspaces,
            loadProjects: loadProjects,
            createDraftProposal: createDraftProposal,
            createPatchProposal: createPatchProposal,
            updateProposal: updateProposal,
            suggestPatch: suggestPatch,
            reviewProposal: reviewProposal,
            submitProposalForReview: submitProposalForReview,
            applyProposal: applyProposal,
            activatePlaybook: activatePlaybook,
            retirePlaybook: retirePlaybook
        )
    }
}

private func sampleGithubAccount() -> GithubAccountDTO {
    GithubAccountDTO(
        id: "gh-account-1",
        connectionId: "conn-gh-1",
        githubUsername: "octocat",
        displayName: "Octo Cat",
        syncCursorSince: nil,
        lastSyncAt: "2026-04-08T08:00:00Z",
        repoCount: 1,
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-08T08:00:00Z"
    )
}

private func sampleGithubRepo() -> GithubRepoDTO {
    GithubRepoDTO(
        id: "gh-repo-1",
        accountId: "gh-account-1",
        githubRepoId: 1,
        owner: "nb",
        name: "popeye",
        fullName: "nb/popeye",
        description: "Popeye repo",
        isPrivate: true,
        isFork: false,
        defaultBranch: "main",
        language: "TypeScript",
        starsCount: 5,
        openIssuesCount: 3,
        lastPushedAt: "2026-04-08T08:00:00Z",
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-08T08:00:00Z"
    )
}

private func sampleGithubPullRequest() -> GithubPullRequestDTO {
    GithubPullRequestDTO(
        id: "gh-pr-1",
        accountId: "gh-account-1",
        repoId: "gh-repo-1",
        githubPrNumber: 42,
        title: "Improve compiler indexing",
        bodyPreview: "Safer compiler indexing.",
        author: "octocat",
        state: "open",
        isDraft: false,
        reviewDecision: "approved",
        ciStatus: "success",
        headBranch: "feature/compiler",
        baseBranch: "main",
        additions: 50,
        deletions: 12,
        changedFiles: 4,
        labels: ["knowledge"],
        requestedReviewers: ["nb"],
        createdAtGh: "2026-04-07T08:00:00Z",
        updatedAtGh: "2026-04-08T08:00:00Z",
        mergedAt: nil,
        createdAt: "2026-04-07T08:00:00Z",
        updatedAt: "2026-04-08T08:00:00Z"
    )
}

private func sampleGithubIssue() -> GithubIssueDTO {
    GithubIssueDTO(
        id: "gh-issue-1",
        accountId: "gh-account-1",
        repoId: "gh-repo-1",
        githubIssueNumber: 7,
        title: "Investigate flaky compile",
        bodyPreview: "Issue detail preview",
        author: "octocat",
        state: "open",
        labels: ["bug"],
        assignees: ["nb"],
        milestone: "v1",
        isAssignedToMe: true,
        isMentioned: false,
        createdAtGh: "2026-04-06T08:00:00Z",
        updatedAtGh: "2026-04-08T08:00:00Z",
        closedAt: nil,
        createdAt: "2026-04-06T08:00:00Z",
        updatedAt: "2026-04-08T08:00:00Z"
    )
}

private func sampleGithubNotification() -> GithubNotificationDTO {
    GithubNotificationDTO(
        id: "gh-notification-1",
        accountId: "gh-account-1",
        githubNotificationId: "github-notification-1",
        repoFullName: "nb/popeye",
        subjectTitle: "Review compiler indexing",
        subjectType: "PullRequest",
        reason: "review_requested",
        isUnread: true,
        updatedAtGh: "2026-04-08T08:00:00Z",
        createdAt: "2026-04-08T08:00:00Z",
        updatedAt: "2026-04-08T08:00:00Z"
    )
}

private func sampleGithubDigest() -> GithubDigestDTO {
    GithubDigestDTO(
        id: "gh-digest-1",
        accountId: "gh-account-1",
        workspaceId: "default",
        date: "2026-04-08",
        openPrsCount: 1,
        reviewRequestsCount: 1,
        assignedIssuesCount: 1,
        unreadNotificationsCount: 1,
        summaryMarkdown: "## GitHub Digest\n\nCompiler work is ready.",
        generatedAt: "2026-04-08T08:00:00Z"
    )
}

private func sampleGithubSearchResult() -> GithubSearchResultDTO {
    GithubSearchResultDTO(
        entityType: "pr",
        entityId: "gh-pr-1",
        repoFullName: "nb/popeye",
        number: 42,
        title: "Improve compiler indexing",
        author: "octocat",
        state: "open",
        updatedAt: "2026-04-08T08:00:00Z",
        score: 0.91
    )
}

private func sampleWorkspace() -> WorkspaceRecordDTO {
    WorkspaceRecordDTO(
        id: "default",
        name: "Default Workspace",
        rootPath: "/tmp/default",
        createdAt: "2026-04-01T08:00:00Z"
    )
}

private func sampleProject() -> ProjectRecordDTO {
    ProjectRecordDTO(
        id: "proj-1",
        workspaceId: "default",
        name: "Project One",
        path: "/tmp/default/project-one",
        createdAt: "2026-04-02T08:00:00Z"
    )
}

private func samplePlaybookRecord(status: String = "active") -> PlaybookRecordDTO {
    PlaybookRecordDTO(
        recordId: "workspace:default:triage",
        playbookId: "triage",
        scope: "workspace",
        workspaceId: "default",
        projectId: nil,
        title: "Workspace triage",
        status: status,
        allowedProfileIds: ["default"],
        filePath: "playbooks/workspace/triage.md",
        currentRevisionHash: "rev-1",
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-08T08:00:00Z",
        effectiveness: samplePlaybookEffectiveness()
    )
}

private func samplePlaybookDetail(status: String = "active") -> PlaybookDetailDTO {
    PlaybookDetailDTO(
        recordId: "workspace:default:triage",
        playbookId: "triage",
        scope: "workspace",
        workspaceId: "default",
        projectId: nil,
        title: "Workspace triage",
        status: status,
        allowedProfileIds: ["default"],
        filePath: "playbooks/workspace/triage.md",
        currentRevisionHash: "rev-1",
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-08T08:00:00Z",
        effectiveness: samplePlaybookEffectiveness(),
        body: "Canonical instructions",
        markdownText: "# Workspace triage\n\nCanonical instructions",
        indexedMemoryId: "memory-1"
    )
}

private func samplePlaybookRevision() -> PlaybookRevisionDTO {
    PlaybookRevisionDTO(
        playbookRecordId: "workspace:default:triage",
        revisionHash: "rev-1",
        title: "Workspace triage",
        status: "active",
        allowedProfileIds: ["default"],
        filePath: "playbooks/workspace/triage.md",
        contentHash: "content-1",
        markdownText: "# Workspace triage\n\nCanonical instructions",
        createdAt: "2026-04-08T08:00:00Z",
        current: true
    )
}

private func samplePlaybookUsage() -> PlaybookUsageRunDTO {
    PlaybookUsageRunDTO(
        runId: "run-1",
        taskId: "task-1",
        jobId: "job-1",
        runState: "succeeded",
        startedAt: "2026-04-08T08:00:00Z",
        finishedAt: "2026-04-08T08:05:00Z",
        interventionCount: 0,
        receiptId: "receipt-1"
    )
}

private func samplePlaybookStaleCandidate() -> PlaybookStaleCandidateDTO {
    PlaybookStaleCandidateDTO(
        recordId: "workspace:default:triage",
        title: "Workspace triage",
        scope: "workspace",
        currentRevisionHash: "rev-1",
        lastUsedAt: "2026-04-08T08:00:00Z",
        useCount30d: 10,
        failedRuns30d: 2,
        interventions30d: 1,
        lastProposalAt: nil,
        indexedMemoryId: "memory-1",
        reasons: ["Repeated repair failures"]
    )
}

private func samplePlaybookProposal(
    id: String = "proposal-1",
    kind: String = "patch",
    status: String,
    appliedRecordId: String? = nil,
    targetRecordId: String? = "workspace:default:triage",
    playbookId: String = "triage",
    scope: String = "workspace",
    workspaceId: String? = "default",
    projectId: String? = nil,
    title: String = "Triage repair",
    body: String = "Updated patch body",
    summary: String = "Repair stale steps",
    allowedProfileIds: [String] = ["default"]
) -> PlaybookProposalDTO {
    PlaybookProposalDTO(
        id: id,
        kind: kind,
        status: status,
        targetRecordId: targetRecordId,
        baseRevisionHash: "rev-1",
        playbookId: playbookId,
        scope: scope,
        workspaceId: workspaceId,
        projectId: projectId,
        title: title,
        proposedStatus: "active",
        allowedProfileIds: allowedProfileIds,
        summary: summary,
        body: body,
        markdownText: "# \(title)\n\n\(body)",
        diffPreview: "+ Improve repair wording",
        contentHash: "content-2",
        revisionHash: "rev-2",
        scanVerdict: "allow",
        scanMatchedRules: [],
        sourceRunId: "run-1",
        proposedBy: "runtime_tool",
        evidence: samplePlaybookEvidence(),
        reviewedBy: status == "approved" || status == "rejected" || status == "applied" ? "native-app" : nil,
        reviewedAt: status == "approved" || status == "rejected" || status == "applied" ? "2026-04-08T08:00:00Z" : nil,
        reviewNote: nil,
        appliedRecordId: appliedRecordId,
        appliedRevisionHash: status == "applied" ? "rev-2" : nil,
        appliedAt: status == "applied" ? "2026-04-08T09:00:00Z" : nil,
        createdAt: "2026-04-08T08:00:00Z",
        updatedAt: "2026-04-08T09:00:00Z"
    )
}

private func samplePlaybookEffectiveness() -> PlaybookEffectivenessDTO {
    PlaybookEffectivenessDTO(
        useCount30d: 14,
        succeededRuns30d: 12,
        failedRuns30d: 1,
        intervenedRuns30d: 1,
        successRate30d: 0.86,
        failureRate30d: 0.07,
        interventionRate30d: 0.07,
        lastUsedAt: "2026-04-08T07:00:00Z",
        lastUpdatedAt: "2026-04-08T08:00:00Z"
    )
}

private func samplePlaybookEvidence() -> PlaybookProposalEvidenceDTO {
    PlaybookProposalEvidenceDTO(
        runIds: ["run-1"],
        interventionIds: ["int-1"],
        lastProblemAt: "2026-04-08T07:00:00Z",
        metrics30d: PlaybookProposalEvidenceMetricsDTO(
            useCount30d: 10,
            failedRuns30d: 2,
            interventions30d: 1
        ),
        suggestedPatchNote: "Repeated repair failures"
    )
}
