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

    @Test("Creating a draft refreshes the visible draft list and preserves thread selection")
    func createDraftPreservesSelection() async {
        let state = EmailDraftStateBox()
        let store = EmailStore(dependencies: .stub(
            loadDrafts: { accountId, _ in
                await state.loadDrafts(accountId: accountId)
            },
            createDraft: { input in
                await state.createDraft(input: input)
            }
        ))

        await store.load()
        let threadID = store.selectedThreadID

        store.beginCreateDraft()
        store.editor?.toText = "annie@example.com"
        store.editor?.subject = "Launch plan"
        store.editor?.body = "Draft the launch note."
        await store.saveDraft()

        #expect(store.visibleDrafts.map(\.subject) == ["Launch plan"])
        #expect(store.visibleDrafts.first?.to == ["annie@example.com"])
        #expect(store.selectedThreadID == threadID)
        #expect(store.editor == nil)
        #expect(store.mutationState == .succeeded("Email draft created"))
    }

    @Test("Editing a persisted draft fetches full detail and updates local draft state")
    func editDraftLoadsDetailAndUpdatesDraft() async {
        let state = EmailDraftStateBox(
            draftsByAccountID: [
                "email-acct-1": [
                    sampleEmailDraft(
                        id: "email-draft-1",
                        accountId: "email-acct-1",
                        providerDraftId: "draft-1",
                        to: ["annie@example.com"],
                        subject: "Launch plan",
                        bodyPreview: "First version"
                    )
                ]
            ],
            draftDetailsByID: [
                "email-draft-1": sampleEmailDraftDetail(
                    id: "email-draft-1",
                    providerDraftId: "draft-1",
                    to: ["annie@example.com"],
                    subject: "Launch plan",
                    bodyPreview: "First version",
                    body: "First version"
                )
            ]
        )
        let store = EmailStore(dependencies: .stub(
            loadDrafts: { accountId, _ in
                await state.loadDrafts(accountId: accountId)
            },
            loadDraft: { id in
                try await state.loadDraft(id: id)
            },
            updateDraft: { id, input in
                await state.updateDraft(id: id, input: input)
            }
        ))

        await store.load()
        guard let draft = store.visibleDrafts.first else {
            Issue.record("Expected a visible draft")
            return
        }

        await store.beginEditDraft(draft)
        #expect(store.editor?.body == "First version")
        store.editor?.subject = "Launch plan v2"
        store.editor?.body = "Expanded second version"
        await store.saveDraft()

        #expect(store.visibleDrafts.first?.subject == "Launch plan v2")
        #expect(store.draftBodiesByProviderDraftID["draft-1"] == "Expanded second version")
        #expect(store.mutationState == .succeeded("Email draft updated"))
    }

    @Test("Reply-all seeds a compose draft from the newest non-self message and preserves selection on save")
    func replyAllSeedsComposeAndCreatesDraft() async {
        let state = EmailDraftStateBox()
        let store = EmailStore(dependencies: .stub(
            loadThreadMessages: { _ in
                [
                    sampleEmailMessage(
                        id: "msg-client",
                        from: "Client <client@example.com>",
                        to: ["operator@example.com", "manager@example.com"],
                        cc: ["legal@example.com"],
                        subject: "Launch plan",
                        bodyPreview: "Need approval from the manager.",
                        receivedAt: "2026-04-09T08:00:00Z"
                    ),
                    sampleEmailMessage(
                        id: "msg-self",
                        from: "Operator <operator@example.com>",
                        to: ["client@example.com"],
                        cc: ["manager@example.com"],
                        subject: "Re: Launch plan",
                        bodyPreview: "I'm on it.",
                        receivedAt: "2026-04-09T09:00:00Z"
                    ),
                ]
            },
            loadDrafts: { accountId, _ in
                await state.loadDrafts(accountId: accountId)
            },
            createDraft: { input in
                await state.createDraft(input: input)
            }
        ))

        await store.load()
        let originalSelection = store.selectedThreadID

        await store.beginReplyAll()

        #expect(store.editor?.composeContext?.kind == .replyAll)
        #expect(store.editor?.toText == "client@example.com, manager@example.com")
        #expect(store.editor?.ccText == "legal@example.com")
        #expect(store.editor?.subject == "Re: Launch plan")
        #expect(store.editor?.body.contains("On 2026-04-09T08:00:00Z, Client <client@example.com> wrote:") == true)
        #expect(store.editor?.body.contains("> Need approval from the manager.") == true)

        await store.saveDraft()

        #expect(store.visibleDrafts.first?.to == ["client@example.com", "manager@example.com"])
        #expect(store.visibleDrafts.first?.cc == ["legal@example.com"])
        #expect(store.selectedThreadID == originalSelection)
        #expect(store.mutationState == .succeeded("Email draft created"))
    }

    @Test("Forward seeds an empty-recipient compose draft with forwarded context")
    func forwardSeedsComposeDraft() async {
        let store = EmailStore(dependencies: .stub(
            loadThreadMessages: { _ in
                [
                    sampleEmailMessage(
                        id: "msg-forward",
                        from: "Founder <founder@example.com>",
                        to: ["operator@example.com"],
                        cc: ["board@example.com"],
                        subject: "Board update",
                        bodyPreview: "Please circulate this update.",
                        receivedAt: "2026-04-09T10:00:00Z"
                    )
                ]
            }
        ))

        await store.load()
        await store.beginForward()

        #expect(store.editor?.composeContext?.kind == .forward)
        #expect(store.editor?.toText.isEmpty == true)
        #expect(store.editor?.ccText.isEmpty == true)
        #expect(store.editor?.subject == "Fwd: Board update")
        #expect(store.editor?.body.contains("---------- Forwarded message ---------") == true)
        #expect(store.editor?.body.contains("From: Founder <founder@example.com>") == true)
        #expect(store.editor?.body.contains("Cc: board@example.com") == true)
        #expect(store.editor?.body.contains("Please circulate this update.") == true)
    }

    @Test("Thread-context compose failure stays local and preserves selected thread")
    func threadComposeFailureStaysLocal() async {
        let store = EmailStore(dependencies: .stub(
            loadThreadMessages: { _ in
                throw APIError.transportUnavailable
            }
        ))

        await store.load()
        let selectedThreadID = store.selectedThreadID

        await store.beginReply()

        #expect(store.editor == nil)
        #expect(store.threadMessageError == .transportUnavailable)
        #expect(store.selectedThreadID == selectedThreadID)
        #expect(store.selectedThread?.id == selectedThreadID)
    }

    @Test("Draft detail load failure stays local and preserves the draft list")
    func draftDetailFailurePreservesDraftList() async {
        let store = EmailStore(dependencies: .stub(
            loadDrafts: { _, _ in
                [sampleEmailDraft(id: "email-draft-1", providerDraftId: "draft-1", subject: "Launch plan", bodyPreview: "Preview")]
            },
            loadDraft: { _ in
                throw APIError.transportUnavailable
            }
        ))

        await store.load()
        let visibleDrafts = store.visibleDrafts

        await store.beginEditDraft(visibleDrafts[0])

        #expect(store.draftDetailError == .transportUnavailable)
        #expect(store.visibleDrafts == visibleDrafts)
        #expect(store.editor == nil)
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

    @Test("Reply works from search results mode")
    func replyWorksFromSearchMode() async {
        let store = EmailStore(dependencies: .stub(
            loadThread: { id in sampleEmailThread(id: id, subject: "Approvals needed") },
            loadThreadMessages: { _ in
                [
                    sampleEmailMessage(
                        id: "msg-search",
                        from: "Founder <founder@example.com>",
                        to: ["operator@example.com"],
                        subject: "Approvals needed",
                        bodyPreview: "Can you approve this today?",
                        receivedAt: "2026-04-09T11:00:00Z"
                    )
                ]
            },
            search: { query, _, _ in
                sampleEmailSearchResponse(query: query, threadId: "thread-search", from: "founder@example.com")
            }
        ))

        await store.load()
        store.searchQuery = "approvals"
        await store.performSearch()
        await store.beginReply()

        #expect(store.isSearchMode == true)
        #expect(store.selectedThreadID == "thread-search")
        #expect(store.editor?.composeContext?.kind == .reply)
        #expect(store.editor?.toText == "founder@example.com")
        #expect(store.editor?.subject == "Re: Approvals needed")
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
        loadThreadMessages: @escaping @Sendable (_ id: String) async throws -> [EmailMessageDTO] = { _ in
            [sampleEmailMessage()]
        },
        loadDigest: @escaping @Sendable (_ accountId: String) async throws -> EmailDigestDTO? = { accountId in
            sampleEmailDigest(accountId: accountId)
        },
        loadDrafts: @escaping @Sendable (_ accountId: String, _ limit: Int) async throws -> [EmailDraftDTO] = { _, _ in
            []
        },
        loadDraft: @escaping @Sendable (_ id: String) async throws -> EmailDraftDetailDTO = { id in
            sampleEmailDraftDetail(id: id, providerDraftId: id)
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
            loadThreadMessages: loadThreadMessages,
            loadDigest: loadDigest,
            loadDrafts: loadDrafts,
            loadDraft: loadDraft,
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

private actor EmailDraftStateBox {
    private var draftsByAccountID: [String: [EmailDraftDTO]]
    private var draftDetailsByID: [String: EmailDraftDetailDTO]

    init(
        draftsByAccountID: [String: [EmailDraftDTO]] = [:],
        draftDetailsByID: [String: EmailDraftDetailDTO] = [:]
    ) {
        self.draftsByAccountID = draftsByAccountID
        self.draftDetailsByID = draftDetailsByID
    }

    func loadDrafts(accountId: String) -> [EmailDraftDTO] {
        draftsByAccountID[accountId] ?? []
    }

    func loadDraft(id: String) throws -> EmailDraftDetailDTO {
        guard let detail = draftDetailsByID[id] else {
            throw APIError.transportUnavailable
        }
        return detail
    }

    func createDraft(input: EmailDraftCreateInput) -> EmailDraftDTO {
        let providerDraftId = "draft-\((draftsByAccountID[input.accountId]?.count ?? 0) + 1)"
        let draft = sampleEmailDraft(
            id: "email-\(providerDraftId)",
            accountId: input.accountId,
            providerDraftId: providerDraftId,
            to: input.to,
            cc: input.cc,
            subject: input.subject,
            bodyPreview: input.body
        )
        draftsByAccountID[input.accountId, default: []].insert(draft, at: 0)
        draftDetailsByID[draft.id] = sampleEmailDraftDetail(
            id: draft.id,
            accountId: draft.accountId,
            providerDraftId: providerDraftId,
            to: input.to,
            cc: input.cc,
            subject: input.subject,
            bodyPreview: input.body,
            body: input.body
        )
        return draft
    }

    func updateDraft(id: String, input: EmailDraftUpdateInput) -> EmailDraftDTO {
        let accountId = input.accountId ?? "email-acct-1"
        let detail = sampleEmailDraftDetail(
            id: "email-draft-1",
            accountId: accountId,
            providerDraftId: id,
            to: input.to ?? ["annie@example.com"],
            cc: input.cc ?? [],
            subject: input.subject ?? "Launch plan",
            bodyPreview: input.body ?? "",
            body: input.body ?? ""
        )
        let draft = sampleEmailDraft(
            id: detail.id,
            accountId: detail.accountId,
            providerDraftId: detail.providerDraftId,
            to: detail.to,
            cc: detail.cc,
            subject: detail.subject,
            bodyPreview: detail.bodyPreview
        )
        draftsByAccountID[accountId] = [draft]
        draftDetailsByID[detail.id] = detail
        return draft
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
    accountId: String = "email-acct-1",
    subject: String = "Launch plan"
) -> EmailThreadDTO {
    EmailThreadDTO(
        id: id,
        accountId: accountId,
        gmailThreadId: "gmail-\(id)",
        subject: subject,
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

private func sampleEmailDraftDetail(
    id: String = "email-draft-1",
    accountId: String = "email-acct-1",
    providerDraftId: String = "draft-1",
    to: [String] = [],
    cc: [String] = [],
    subject: String = "Launch plan",
    bodyPreview: String = "Draft the launch note.",
    body: String = "Draft the launch note."
) -> EmailDraftDetailDTO {
    EmailDraftDetailDTO(
        id: id,
        accountId: accountId,
        connectionId: "conn-email-1",
        providerDraftId: providerDraftId,
        providerMessageId: nil,
        to: to,
        cc: cc,
        subject: subject,
        bodyPreview: bodyPreview,
        updatedAt: "2026-04-09T09:00:00Z",
        body: body
    )
}

private func sampleEmailMessage(
    id: String = "msg-1",
    threadId: String = "thread-1",
    accountId: String = "email-acct-1",
    from: String = "Annie <annie@example.com>",
    to: [String] = ["operator@example.com"],
    cc: [String] = [],
    subject: String = "Launch plan",
    snippet: String = "Draft the launch note.",
    bodyPreview: String = "Draft the launch note.",
    receivedAt: String = "2026-04-09T09:00:00Z"
) -> EmailMessageDTO {
    EmailMessageDTO(
        id: id,
        threadId: threadId,
        accountId: accountId,
        gmailMessageId: "gmail-\(id)",
        from: from,
        to: to,
        cc: cc,
        subject: subject,
        snippet: snippet,
        bodyPreview: bodyPreview,
        receivedAt: receivedAt,
        sizeEstimate: 512,
        labelIds: ["INBOX"],
        createdAt: receivedAt,
        updatedAt: receivedAt
    )
}
