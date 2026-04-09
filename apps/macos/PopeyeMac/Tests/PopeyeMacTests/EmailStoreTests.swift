import Foundation
import Testing

@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("Email Store")
struct EmailStoreTests {
    @Test("Load selects the default account and thread detail")
    func loadHydratesSelectedThread() async {
        let store = EmailStore(dependencies: .stub())

        await store.load()

        #expect(store.accounts.count == 1)
        #expect(store.selectedAccountID == "email-acct-1")
        #expect(store.selectedThreadID == "thread-1")
        #expect(store.selectedThread?.id == "thread-1")
    }

    @Test("Sync and digest mutations update mailbox summaries")
    func mailboxOperationsUpdateSummary() async {
        let state = EmailStateBox(digest: sampleEmailDigest())
        let store = EmailStore(dependencies: .stub(
            loadDigest: { accountId in
                await state.loadDigest(accountId: accountId)
            },
            syncAccount: { accountId in
                EmailSyncResultDTO(accountId: accountId, synced: 7, updated: 3, errors: [])
            },
            generateDigest: { accountId in
                await state.generateDigest(accountId: accountId)
            }
        ))

        await store.load()
        await store.syncSelectedAccount()
        await store.generateDigest()

        #expect(store.visibleSyncResult?.synced == 7)
        #expect(store.digest?.unreadCount == 5)
        #expect(store.mutationState == .succeeded("Email digest generated"))
    }

    @Test("Creating a draft caches it locally and preserves thread selection")
    func createDraftPreservesSelection() async {
        let store = EmailStore(dependencies: .stub())

        await store.load()
        let threadID = store.selectedThreadID

        store.beginCreateDraft()
        store.editor?.toText = "annie@example.com"
        store.editor?.subject = "Launch plan"
        store.editor?.body = "Draft the launch note."
        await store.saveDraft()

        #expect(store.visibleDraft?.subject == "Launch plan")
        #expect(store.visibleDraft?.to == ["annie@example.com"])
        #expect(store.selectedThreadID == threadID)
        #expect(store.editor == nil)
        #expect(store.canEditVisibleDraft == true)
        #expect(store.mutationState == .succeeded("Email draft created"))
    }

    @Test("Editing a cached draft updates local full-body state")
    func editDraftUsesLocalCachedBody() async {
        let store = EmailStore(dependencies: .stub())

        await store.load()
        store.beginCreateDraft()
        store.editor?.toText = "annie@example.com"
        store.editor?.subject = "Launch plan"
        store.editor?.body = "First version"
        await store.saveDraft()

        store.beginEditVisibleDraft()
        #expect(store.editor?.body == "First version")
        store.editor?.subject = "Launch plan v2"
        store.editor?.body = "Expanded second version"
        await store.saveDraft()

        #expect(store.visibleDraft?.subject == "Launch plan v2")
        #expect(store.draftBodiesByProviderDraftID["draft-1"] == "Expanded second version")
        #expect(store.mutationState == .succeeded("Email draft updated"))
    }

    @Test("Draft validation blocks empty subjects and invalid recipients")
    func draftValidation() async {
        let store = EmailStore(dependencies: .stub())

        await store.load()
        store.beginCreateDraft()

        #expect(store.canSaveDraft == false)
        #expect(store.draftValidationMessage == "Enter a subject.")

        store.editor?.subject = "Valid subject"
        store.editor?.toText = "bad-address"
        #expect(store.draftValidationMessage == "bad-address is not a valid email address.")
        #expect(store.canSaveDraft == false)

        store.editor?.toText = "annie@example.com, ben@example.com"
        #expect(store.draftValidationMessage == nil)
        #expect(store.canSaveDraft == true)
    }

    @Test("Unread-only toggle reloads inbox threads")
    func unreadToggleReloadsThreads() async {
        let loadRecorder = LoadThreadsRecorder()
        let store = EmailStore(dependencies: .stub(
            loadThreads: { accountId, limit, unreadOnly in
                await loadRecorder.record(accountId: accountId, limit: limit, unreadOnly: unreadOnly)
                return [sampleEmailThread(id: unreadOnly ? "thread-unread" : "thread-1", accountId: accountId)]
            }
        ))

        await store.load()
        store.isUnreadOnly = true
        await store.didChangeUnreadOnly()

        #expect(store.threads.map(\.id) == ["thread-unread"])
        #expect(store.selectedThreadID == "thread-unread")
        #expect(await loadRecorder.lastUnreadOnly == true)
    }

    @Test("Search loads result mode and selected thread detail")
    func searchLoadsResultsAndDetail() async {
        let store = EmailStore(dependencies: .stub(
            loadThread: { id in
                sampleEmailThread(id: id)
            },
            search: { query, _, _ in
                sampleEmailSearchResponse(query: query, threadId: "thread-search", from: "founder@example.com")
            }
        ))

        await store.load()
        store.searchQuery = "approvals"
        await store.performSearch()

        #expect(store.isSearchMode == true)
        #expect(store.activeSearchQuery == "approvals")
        #expect(store.searchResults.map { $0.threadId } == ["thread-search"])
        #expect(store.selectedThreadID == "thread-search")
        #expect(store.selectedThread?.id == "thread-search")
        #expect(store.searchError == nil)
    }

    @Test("Clear search restores inbox browsing selection")
    func clearSearchRestoresInboxMode() async {
        let store = EmailStore(dependencies: .stub(
            loadThreads: { accountId, _, unreadOnly in
                [sampleEmailThread(id: unreadOnly ? "thread-unread" : "thread-1", accountId: accountId)]
            },
            loadThread: { id in sampleEmailThread(id: id) },
            search: { query, _, _ in
                sampleEmailSearchResponse(query: query, threadId: "thread-search", from: "founder@example.com")
            }
        ))

        await store.load()
        store.searchQuery = "launch"
        await store.performSearch()
        await store.clearSearch()

        #expect(store.isSearchMode == false)
        #expect(store.searchQuery.isEmpty)
        #expect(store.searchResults.isEmpty)
        #expect(store.selectedThreadID == "thread-1")
        #expect(store.selectedThread?.id == "thread-1")
    }

    @Test("Search failure stays local and preserves inbox data")
    func searchFailureDoesNotBlankInbox() async {
        let store = EmailStore(dependencies: .stub(
            search: { _, _, _ in throw APIError.transportUnavailable }
        ))

        await store.load()
        let originalThreadIDs = store.threads.map(\.id)
        let originalSelectedThreadID = store.selectedThreadID

        store.searchQuery = "launch"
        await store.performSearch()

        #expect(store.searchError == .transportUnavailable)
        #expect(store.isSearchMode == false)
        #expect(store.threads.map(\.id) == originalThreadIDs)
        #expect(store.selectedThreadID == originalSelectedThreadID)
        #expect(store.selectedThread?.id == originalSelectedThreadID)
    }
}

extension EmailStore.Dependencies {
    fileprivate static func stub(
        loadAccounts: @escaping @Sendable () async throws -> [EmailAccountDTO] = {
            [sampleEmailAccount()]
        },
        loadThreads: @escaping @Sendable (_ accountId: String, _ limit: Int, _ unreadOnly: Bool) async throws -> [EmailThreadDTO] = { accountId, _, _ in
            [sampleEmailThread(accountId: accountId)]
        },
        loadThread: @escaping @Sendable (_ id: String) async throws -> EmailThreadDTO = { id in
            sampleEmailThread(id: id)
        },
        loadDigest: @escaping @Sendable (_ accountId: String) async throws -> EmailDigestDTO? = { accountId in
            sampleEmailDigest(accountId: accountId)
        },
        search: @escaping @Sendable (_ query: String, _ accountId: String, _ limit: Int) async throws -> EmailSearchResponseDTO = { query, _, _ in
            sampleEmailSearchResponse(query: query)
        },
        syncAccount: @escaping @Sendable (_ accountId: String) async throws -> EmailSyncResultDTO = { accountId in
            EmailSyncResultDTO(accountId: accountId, synced: 3, updated: 1, errors: [])
        },
        generateDigest: @escaping @Sendable (_ accountId: String) async throws -> EmailDigestDTO? = { accountId in
            sampleEmailDigest(accountId: accountId, unreadCount: 5, highSignalCount: 2)
        },
        createDraft: @escaping @Sendable (_ input: EmailDraftCreateInput) async throws -> EmailDraftDTO = { input in
            sampleEmailDraft(accountId: input.accountId, to: input.to, cc: input.cc, subject: input.subject, bodyPreview: input.body)
        },
        updateDraft: @escaping @Sendable (_ id: String, _ input: EmailDraftUpdateInput) async throws -> EmailDraftDTO = { id, input in
            sampleEmailDraft(
                id: id == "draft-1" ? "email-draft-1" : id,
                accountId: input.accountId ?? "email-acct-1",
                providerDraftId: id,
                to: input.to ?? ["annie@example.com"],
                cc: input.cc ?? [],
                subject: input.subject ?? "Launch plan",
                bodyPreview: input.body ?? ""
            )
        },
        emitInvalidation: @escaping @Sendable (_ signal: InvalidationSignal) -> Void = { _ in }
    ) -> Self {
        Self(
            loadAccounts: loadAccounts,
            loadThreads: loadThreads,
            loadThread: loadThread,
            loadDigest: loadDigest,
            search: search,
            syncAccount: syncAccount,
            generateDigest: generateDigest,
            createDraft: createDraft,
            updateDraft: updateDraft,
            emitInvalidation: emitInvalidation
        )
    }
}

private actor EmailStateBox {
    private var digest: EmailDigestDTO?

    init(digest: EmailDigestDTO?) {
        self.digest = digest
    }

    func loadDigest(accountId: String) -> EmailDigestDTO? {
        guard digest?.accountId == accountId else { return nil }
        return digest
    }

    func generateDigest(accountId: String) -> EmailDigestDTO {
        let next = sampleEmailDigest(
            accountId: accountId,
            unreadCount: 5,
            highSignalCount: 2,
            generatedAt: "2026-04-10T09:00:00Z"
        )
        digest = next
        return next
    }
}

private actor LoadThreadsRecorder {
    private(set) var lastUnreadOnly = false

    func record(accountId _: String, limit _: Int, unreadOnly: Bool) {
        lastUnreadOnly = unreadOnly
    }
}

private func sampleEmailAccount() -> EmailAccountDTO {
    EmailAccountDTO(
        id: "email-acct-1",
        connectionId: "conn-email-1",
        emailAddress: "operator@example.com",
        displayName: "Work Inbox",
        syncCursorPageToken: nil,
        syncCursorHistoryId: nil,
        lastSyncAt: "2026-04-09T09:00:00Z",
        messageCount: 12,
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-09T09:00:00Z"
    )
}

private func sampleEmailThread(
    id: String = "thread-1",
    accountId: String = "email-acct-1"
) -> EmailThreadDTO {
    EmailThreadDTO(
        id: id,
        accountId: accountId,
        gmailThreadId: "gmail-\(id)",
        subject: "Launch plan",
        snippet: "Draft the launch note and gather approvals.",
        lastMessageAt: "2026-04-09T09:00:00Z",
        messageCount: 2,
        labelIds: ["INBOX"],
        isUnread: true,
        isStarred: false,
        importance: "high",
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-09T09:00:00Z"
    )
}

private func sampleEmailDigest(
    accountId: String = "email-acct-1",
    unreadCount: Int = 3,
    highSignalCount: Int = 1,
    generatedAt: String = "2026-04-09T09:00:00Z"
) -> EmailDigestDTO {
    EmailDigestDTO(
        id: "email-digest-1",
        accountId: accountId,
        workspaceId: "default",
        date: "2026-04-09",
        unreadCount: unreadCount,
        highSignalCount: highSignalCount,
        summaryMarkdown: "Three unread items need attention.",
        generatedAt: generatedAt
    )
}

private func sampleEmailSearchResponse(
    query: String = "launch",
    threadId: String = "thread-search",
    from: String = "annie@example.com"
) -> EmailSearchResponseDTO {
    EmailSearchResponseDTO(
        query: query,
        results: [
            EmailSearchResultDTO(
                threadId: threadId,
                subject: "Launch approval follow-up",
                snippet: "Need approvals on the launch note.",
                from: from,
                lastMessageAt: "2026-04-10T09:00:00Z",
                score: 0.98
            )
        ]
    )
}

private func sampleEmailDraft(
    id: String = "email-draft-1",
    accountId: String = "email-acct-1",
    providerDraftId: String = "draft-1",
    to: [String] = [],
    cc: [String] = [],
    subject: String = "Launch plan",
    bodyPreview: String = "Draft the launch note."
) -> EmailDraftDTO {
    EmailDraftDTO(
        id: id,
        accountId: accountId,
        connectionId: "conn-email-1",
        providerDraftId: providerDraftId,
        providerMessageId: nil,
        to: to,
        cc: cc,
        subject: subject,
        bodyPreview: bodyPreview,
        updatedAt: "2026-04-09T09:00:00Z"
    )
}
