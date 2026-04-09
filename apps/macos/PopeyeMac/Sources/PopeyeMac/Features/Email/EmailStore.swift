import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class EmailStore {
    struct DraftEditor: Equatable, Sendable {
        enum Mode: String, Sendable {
            case create
            case edit
        }

        enum ComposeKind: String, Sendable {
            case reply
            case replyAll
            case forward
        }

        struct ComposeContext: Equatable, Sendable {
            var kind: ComposeKind
            var sourceThreadID: String
            var sourceMessageID: String
            var sourceSender: String
            var sourceSubject: String
            var sourceReceivedAt: String
        }

        var mode: Mode
        var draftProviderDraftId: String?
        var accountId: String
        var toText: String
        var ccText: String
        var subject: String
        var body: String
        var composeContext: ComposeContext?
    }

    struct Dependencies: Sendable {
        var loadAccounts: @Sendable () async throws -> [EmailAccountDTO]
        var loadThreads: @Sendable (_ accountId: String, _ limit: Int, _ unreadOnly: Bool) async throws -> [EmailThreadDTO]
        var loadThread: @Sendable (_ id: String) async throws -> EmailThreadDTO
        var loadThreadMessages: @Sendable (_ id: String) async throws -> [EmailMessageDTO]
        var loadDigest: @Sendable (_ accountId: String) async throws -> EmailDigestDTO?
        var loadDrafts: @Sendable (_ accountId: String, _ limit: Int) async throws -> [EmailDraftDTO]
        var loadDraft: @Sendable (_ id: String) async throws -> EmailDraftDetailDTO
        var search: @Sendable (_ query: String, _ accountId: String, _ limit: Int) async throws -> EmailSearchResponseDTO
        var syncAccount: @Sendable (_ accountId: String) async throws -> EmailSyncResultDTO
        var generateDigest: @Sendable (_ accountId: String) async throws -> EmailDigestDTO?
        var createDraft: @Sendable (_ input: EmailDraftCreateInput) async throws -> EmailDraftDTO
        var updateDraft: @Sendable (_ id: String, _ input: EmailDraftUpdateInput) async throws -> EmailDraftDTO
        var emitInvalidation: @Sendable (_ signal: InvalidationSignal) -> Void

        static func live(client: ControlAPIClient) -> Dependencies {
            let service = EmailDomainService(client: client)
            return Dependencies(
                loadAccounts: { try await service.loadAccounts() },
                loadThreads: { accountId, limit, unreadOnly in
                    try await service.loadThreads(accountId: accountId, limit: limit, unreadOnly: unreadOnly)
                },
                loadThread: { id in try await service.loadThread(id: id) },
                loadThreadMessages: { id in try await service.loadThreadMessages(id: id) },
                loadDigest: { accountId in try await service.loadDigest(accountId: accountId) },
                loadDrafts: { accountId, limit in try await service.loadDrafts(accountId: accountId, limit: limit) },
                loadDraft: { id in try await service.loadDraft(id: id) },
                search: { query, accountId, limit in
                    try await service.search(query: query, accountId: accountId, limit: limit)
                },
                syncAccount: { accountId in try await service.sync(accountId: accountId) },
                generateDigest: { accountId in try await service.generateDigest(accountId: accountId) },
                createDraft: { input in try await service.createDraft(input: input) },
                updateDraft: { id, input in try await service.updateDraft(id: id, input: input) },
                emitInvalidation: { signal in
                    NotificationCenter.default.post(name: .popeyeInvalidation, object: signal)
                }
            )
        }
    }

    var accounts: [EmailAccountDTO] = []
    var threads: [EmailThreadDTO] = []
    var digest: EmailDigestDTO?
    var selectedAccountID: String?
    var selectedThreadID: String?
    var selectedThread: EmailThreadDTO?
    var isLoading = false
    var error: APIError?
    var searchQuery = ""
    var activeSearchQuery: String?
    var searchResults: [EmailSearchResultDTO] = []
    var isUnreadOnly = false
    var searchPhase: ScreenOperationPhase = .idle
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            accounts = []
            threads = []
            digest = nil
            selectedAccountID = nil
            selectedThreadID = nil
            selectedThread = nil
            searchQuery = ""
            activeSearchQuery = nil
            searchResults = []
            isUnreadOnly = false
            searchPhase = .idle
            inboxSelectedThreadID = nil
            editor = nil
            lastSyncResult = nil
            draftsByAccountID = [:]
            draftBodiesByProviderDraftID = [:]
            draftDetailPhase = .idle
            threadMessagesByThreadID = [:]
            threadMessagePhase = .idle
            isLoading = false
            error = nil
            mutations.dismiss()
        }
    }

    var editor: DraftEditor?
    var lastSyncResult: EmailSyncResultDTO?
    var draftsByAccountID: [String: [EmailDraftDTO]] = [:]
    var draftBodiesByProviderDraftID: [String: String] = [:]
    var draftDetailPhase: ScreenOperationPhase = .idle
    var threadMessagesByThreadID: [String: [EmailMessageDTO]] = [:]
    var threadMessagePhase: ScreenOperationPhase = .idle

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let dependencies: Dependencies
    private var inboxSelectedThreadID: String?

    init(client: ControlAPIClient) {
        self.dependencies = .live(client: client)
    }

    init(dependencies: Dependencies) {
        self.dependencies = dependencies
    }

    var activeAccount: EmailAccountDTO? {
        guard let selectedAccountID else { return accounts.first }
        return accounts.first(where: { $0.id == selectedAccountID }) ?? accounts.first
    }

    var visibleDrafts: [EmailDraftDTO] {
        guard let activeAccount else { return [] }
        return draftsByAccountID[activeAccount.id] ?? []
    }

    var visibleThreadMessages: [EmailMessageDTO] {
        guard let selectedThreadID else { return [] }
        return threadMessagesByThreadID[selectedThreadID] ?? []
    }

    var visibleSyncResult: EmailSyncResultDTO? {
        guard let activeAccount else { return nil }
        guard lastSyncResult?.accountId == activeAccount.id else { return nil }
        return lastSyncResult
    }

    var visibleSearchResultCount: Int {
        isSearchMode ? searchResults.count : 0
    }

    var isSearchMode: Bool {
        activeSearchQuery != nil
    }

    var searchError: APIError? {
        searchPhase.error
    }

    var isSearching: Bool {
        searchPhase.isLoading
    }

    var draftDetailError: APIError? {
        draftDetailPhase.error
    }

    var isLoadingDraftDetail: Bool {
        draftDetailPhase.isLoading
    }

    var threadMessageError: APIError? {
        threadMessagePhase.error
    }

    var isLoadingThreadMessages: Bool {
        threadMessagePhase.isLoading
    }

    var canSyncSelectedAccount: Bool {
        activeAccount != nil && mutationState != .executing && isSearching == false && isLoadingDraftDetail == false
    }

    var canGenerateDigest: Bool {
        activeAccount != nil && mutationState != .executing && isSearching == false && isLoadingDraftDetail == false
    }

    var canCreateDraft: Bool {
        activeAccount != nil && mutationState != .executing && isSearching == false && isLoadingDraftDetail == false
    }

    var canBeginDraftEdit: Bool {
        activeAccount != nil && mutationState != .executing && isSearching == false && isLoadingDraftDetail == false
    }

    var canComposeSelectedThread: Bool {
        activeAccount != nil
            && selectedThread != nil
            && mutationState != .executing
            && isLoadingDraftDetail == false
            && isLoadingThreadMessages == false
    }

    var canSearch: Bool {
        activeAccount != nil
            && trimmedSearchQuery.isEmpty == false
            && mutationState != .executing
            && isSearching == false
            && isLoadingDraftDetail == false
    }

    var canToggleUnreadOnly: Bool {
        activeAccount != nil && mutationState != .executing && isSearching == false && isLoadingDraftDetail == false
    }

    var canClearSearch: Bool {
        isSearchMode && mutationState != .executing && isSearching == false && isLoadingDraftDetail == false
    }

    var draftValidationMessage: String? {
        guard let editor else { return nil }
        if editor.subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Enter a subject."
        }

        let invalidRecipients = (Self.parseRecipients(editor.toText) + Self.parseRecipients(editor.ccText))
            .filter { Self.isValidEmailAddress($0) == false }
        if let invalid = invalidRecipients.first {
            return "\(invalid) is not a valid email address."
        }

        return nil
    }

    var canSaveDraft: Bool {
        editor != nil && draftValidationMessage == nil && mutationState != .executing && isSearching == false && isLoadingDraftDetail == false
    }

    func load() async {
        isLoading = true
        error = nil
        searchPhase = .idle
        threadMessagesByThreadID = [:]
        threadMessagePhase = .idle
        defer { isLoading = false }

        do {
            accounts = try await dependencies.loadAccounts()
            if selectedAccountID == nil || accounts.contains(where: { $0.id == selectedAccountID }) == false {
                selectedAccountID = accounts.first?.id
            }

            guard let accountId = activeAccount?.id else {
                threads = []
                digest = nil
                selectedThreadID = nil
                selectedThread = nil
                clearSearchState(resetQuery: true)
                inboxSelectedThreadID = nil
                draftDetailPhase = .idle
                threadMessagesByThreadID = [:]
                threadMessagePhase = .idle
                return
            }

            try await reloadInboxSnapshot(accountId: accountId)
            if isSearchMode {
                try await refreshActiveSearch(accountId: accountId)
            } else {
                try await restoreInboxSelectionAndLoadDetail()
            }
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
    }

    func handleSelectedAccountChange(oldValue: String?, newValue: String?) async {
        guard oldValue != newValue else { return }
        guard oldValue != nil else { return }
        clearSearchState(resetQuery: true)
        draftDetailPhase = .idle
        threadMessagesByThreadID = [:]
        threadMessagePhase = .idle
        editor = nil
        inboxSelectedThreadID = nil
        selectedThreadID = nil
        selectedThread = nil
        await load()
    }

    func handleSelectedThreadChange(_ id: String?) async {
        if isSearchMode == false {
            inboxSelectedThreadID = id
        }
        guard let id else {
            selectedThread = nil
            threadMessagePhase = .idle
            return
        }
        guard selectedThread?.id != id else { return }
        await loadThreadContext(id: id)
    }

    func didChangeUnreadOnly() async {
        guard isSearchMode == false else { return }
        await reloadMailbox()
    }

    func performSearch() async {
        let query = trimmedSearchQuery
        guard let account = activeAccount, query.isEmpty == false else {
            await clearSearch()
            return
        }

        searchPhase = .loading

        do {
            let response = try await dependencies.search(query, account.id, 20)
            activeSearchQuery = response.query
            searchResults = response.results
            searchPhase = .idle
            try await restoreSearchSelectionAndLoadDetail()
        } catch {
            searchPhase = .failed(Self.map(error))
        }
    }

    func clearSearch() async {
        clearSearchState(resetQuery: true)
        await reloadMailbox()
    }

    func syncSelectedAccount() async {
        guard let account = activeAccount else { return }
        await mutations.execute(
            action: {
                self.lastSyncResult = try await self.dependencies.syncAccount(account.id)
                self.dependencies.emitInvalidation(.general)
            },
            successMessage: "Mailbox synced",
            fallbackError: "Couldn't sync mailbox",
            reload: { [weak self] in
                await self?.load()
            }
        )
    }

    func generateDigest() async {
        guard let account = activeAccount else { return }
        await mutations.execute(
            action: {
                self.digest = try await self.dependencies.generateDigest(account.id)
                self.dependencies.emitInvalidation(.general)
            },
            successMessage: "Email digest generated",
            fallbackError: "Couldn't generate email digest",
            reload: { [weak self] in
                await self?.load()
            }
        )
    }

    func beginCreateDraft() {
        guard let account = activeAccount else { return }
        draftDetailPhase = .idle
        editor = DraftEditor(
            mode: .create,
            draftProviderDraftId: nil,
            accountId: account.id,
            toText: "",
            ccText: "",
            subject: "",
            body: "",
            composeContext: nil
        )
    }

    func beginReply() async {
        await beginThreadCompose(kind: .reply)
    }

    func beginReplyAll() async {
        await beginThreadCompose(kind: .replyAll)
    }

    func beginForward() async {
        await beginThreadCompose(kind: .forward)
    }

    func beginEditDraft(_ draft: EmailDraftDTO) async {
        guard canBeginDraftEdit else { return }

        if let cachedBody = draftBodiesByProviderDraftID[draft.providerDraftId] {
            draftDetailPhase = .idle
            editor = DraftEditor(
                mode: .edit,
                draftProviderDraftId: draft.providerDraftId,
                accountId: draft.accountId,
                toText: draft.to.joined(separator: ", "),
                ccText: draft.cc.joined(separator: ", "),
                subject: draft.subject,
                body: cachedBody,
                composeContext: nil
            )
            return
        }

        draftDetailPhase = .loading
        do {
            let detail = try await dependencies.loadDraft(draft.id)
            cacheDraftDetail(detail)
            draftDetailPhase = .idle
            editor = DraftEditor(
                mode: .edit,
                draftProviderDraftId: detail.providerDraftId,
                accountId: detail.accountId,
                toText: detail.to.joined(separator: ", "),
                ccText: detail.cc.joined(separator: ", "),
                subject: detail.subject,
                body: detail.body,
                composeContext: nil
            )
        } catch {
            draftDetailPhase = .failed(Self.map(error))
        }
    }

    func cancelDraftEditor() {
        editor = nil
    }

    func saveDraft() async {
        guard let editor, canSaveDraft else { return }
        let to = Self.parseRecipients(editor.toText)
        let cc = Self.parseRecipients(editor.ccText)
        let subject = editor.subject.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = editor.body

        switch editor.mode {
        case .create:
            await mutations.execute(
                action: {
                    let draft = try await self.dependencies.createDraft(
                        EmailDraftCreateInput(
                            accountId: editor.accountId,
                            to: to,
                            cc: cc,
                            subject: subject,
                            body: body
                        )
                    )
                    self.cacheDraft(draft, fullBody: body)
                    self.editor = nil
                    self.dependencies.emitInvalidation(.general)
                },
                successMessage: "Email draft created",
                fallbackError: "Couldn't create email draft",
                reload: { [weak self] in
                    await self?.load()
                }
            )
        case .edit:
            guard let draftProviderDraftId = editor.draftProviderDraftId else { return }
            await mutations.execute(
                action: {
                    let draft = try await self.dependencies.updateDraft(
                        draftProviderDraftId,
                        EmailDraftUpdateInput(
                            accountId: editor.accountId,
                            to: to,
                            cc: cc,
                            subject: subject,
                            body: body
                        )
                    )
                    self.cacheDraft(draft, fullBody: body)
                    self.editor = nil
                    self.dependencies.emitInvalidation(.general)
                },
                successMessage: "Email draft updated",
                fallbackError: "Couldn't update email draft",
                reload: { [weak self] in
                    await self?.load()
                }
            )
        }
    }

    func dismissMutation() {
        mutations.dismiss()
    }

    private var trimmedSearchQuery: String {
        searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func reloadMailbox() async {
        guard let accountId = activeAccount?.id else { return }
        do {
            try await reloadInboxSnapshot(accountId: accountId)
            if isSearchMode {
                try await refreshActiveSearch(accountId: accountId)
            } else {
                try await restoreInboxSelectionAndLoadDetail()
            }
        } catch {
            self.error = Self.map(error)
        }
    }

    private func reloadInboxSnapshot(accountId: String) async throws {
        async let loadedThreads = dependencies.loadThreads(accountId, 50, isUnreadOnly)
        async let loadedDigest = dependencies.loadDigest(accountId)
        async let loadedDrafts = dependencies.loadDrafts(accountId, 20)
        threads = try await loadedThreads
        digest = try await loadedDigest
        draftsByAccountID[accountId] = try await loadedDrafts
    }

    private func refreshActiveSearch(accountId: String) async throws {
        guard let currentSearchQuery = activeSearchQuery else { return }
        searchPhase = .loading
        do {
            let response = try await dependencies.search(currentSearchQuery, accountId, 20)
            activeSearchQuery = response.query
            searchResults = response.results
            searchPhase = .idle
            try await restoreSearchSelectionAndLoadDetail()
        } catch {
            searchPhase = .failed(Self.map(error))
        }
    }

    private func restoreInboxSelectionAndLoadDetail() async throws {
        if let inboxSelectedThreadID,
           threads.contains(where: { $0.id == inboxSelectedThreadID }) {
            selectedThreadID = inboxSelectedThreadID
        } else {
            selectedThreadID = threads.first?.id
            inboxSelectedThreadID = selectedThreadID
        }

        if let selectedThreadID {
            await loadThreadContext(id: selectedThreadID)
        } else {
            selectedThread = nil
            threadMessagePhase = .idle
        }
    }

    private func restoreSearchSelectionAndLoadDetail() async throws {
        if let selectedThreadID,
           searchResults.contains(where: { $0.threadId == selectedThreadID }) {
            self.selectedThreadID = selectedThreadID
        } else {
            selectedThreadID = searchResults.first?.threadId
        }

        if let selectedThreadID {
            await loadThreadContext(id: selectedThreadID)
        } else {
            selectedThread = nil
            threadMessagePhase = .idle
        }
    }

    private func loadThreadContext(id: String) async {
        threadMessagePhase = .loading
        do {
            selectedThread = try await dependencies.loadThread(id)
        } catch {
            selectedThread = nil
            threadMessagePhase = .failed(Self.map(error))
            PopeyeLogger.refresh.error("Email thread load failed: \(error)")
            return
        }

        do {
            threadMessagesByThreadID[id] = try await dependencies.loadThreadMessages(id)
            threadMessagePhase = .idle
        } catch {
            threadMessagePhase = .failed(Self.map(error))
            PopeyeLogger.refresh.error("Email thread messages load failed: \(error)")
        }
    }

    @discardableResult
    private func ensureThreadMessages(threadID: String) async -> [EmailMessageDTO]? {
        if let cached = threadMessagesByThreadID[threadID] {
            threadMessagePhase = .idle
            return cached
        }
        await loadThreadContext(id: threadID)
        return threadMessagesByThreadID[threadID]
    }

    private func beginThreadCompose(kind: DraftEditor.ComposeKind) async {
        guard canComposeSelectedThread, let account = activeAccount, let thread = selectedThread else { return }
        guard let messages = await ensureThreadMessages(threadID: thread.id), messages.isEmpty == false else {
            if threadMessageError == nil {
                threadMessagePhase = .failed(.apiFailure(statusCode: -1, message: "No messages are available for this thread yet."))
            }
            return
        }

        guard let targetMessage = Self.composeTargetMessage(kind: kind, messages: messages, accountEmail: account.emailAddress) else {
            threadMessagePhase = .failed(.apiFailure(statusCode: -1, message: "Couldn't derive a compose target from this thread."))
            return
        }

        let seed = Self.composeSeed(
            kind: kind,
            account: account,
            thread: thread,
            targetMessage: targetMessage
        )
        draftDetailPhase = .idle
        editor = DraftEditor(
            mode: .create,
            draftProviderDraftId: nil,
            accountId: account.id,
            toText: seed.to.joined(separator: ", "),
            ccText: seed.cc.joined(separator: ", "),
            subject: seed.subject,
            body: seed.body,
            composeContext: .init(
                kind: kind,
                sourceThreadID: thread.id,
                sourceMessageID: targetMessage.id,
                sourceSender: targetMessage.from,
                sourceSubject: targetMessage.subject.isEmpty ? thread.subject : targetMessage.subject,
                sourceReceivedAt: targetMessage.receivedAt
            )
        )
    }

    private func clearSearchState(resetQuery: Bool) {
        if resetQuery {
            searchQuery = ""
        }
        activeSearchQuery = nil
        searchResults = []
        searchPhase = .idle
    }

    private func cacheDraft(_ draft: EmailDraftDTO, fullBody: String) {
        cacheDraftSummary(draft)
        draftBodiesByProviderDraftID[draft.providerDraftId] = fullBody
    }

    private func cacheDraftSummary(_ draft: EmailDraftDTO) {
        var drafts = draftsByAccountID[draft.accountId] ?? []
        if let existingIndex = drafts.firstIndex(where: { $0.id == draft.id || $0.providerDraftId == draft.providerDraftId }) {
            drafts[existingIndex] = draft
        } else {
            drafts.insert(draft, at: 0)
        }
        draftsByAccountID[draft.accountId] = drafts.sorted { $0.updatedAt > $1.updatedAt }
    }

    private func cacheDraftDetail(_ detail: EmailDraftDetailDTO) {
        cacheDraftSummary(
            EmailDraftDTO(
                id: detail.id,
                accountId: detail.accountId,
                connectionId: detail.connectionId,
                providerDraftId: detail.providerDraftId,
                providerMessageId: detail.providerMessageId,
                to: detail.to,
                cc: detail.cc,
                subject: detail.subject,
                bodyPreview: detail.bodyPreview,
                updatedAt: detail.updatedAt
            )
        )
        draftBodiesByProviderDraftID[detail.providerDraftId] = detail.body
    }

    fileprivate static func parseRecipients(_ value: String) -> [String] {
        value
            .split(whereSeparator: { $0 == "," || $0 == "\n" })
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    fileprivate static func extractMailbox(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return nil }
        if let start = trimmed.firstIndex(of: "<"), let end = trimmed[start...].firstIndex(of: ">"), start < end {
            let mailbox = trimmed[trimmed.index(after: start)..<end].trimmingCharacters(in: .whitespacesAndNewlines)
            return mailbox.isEmpty ? nil : mailbox
        }
        return trimmed
    }

    fileprivate static func composeTargetMessage(
        kind: DraftEditor.ComposeKind,
        messages: [EmailMessageDTO],
        accountEmail: String
    ) -> EmailMessageDTO? {
        switch kind {
        case .forward:
            return messages.last
        case .reply, .replyAll:
            let selfMailbox = accountEmail.lowercased()
            return messages.last(where: {
                extractMailbox($0.from)?.lowercased() != selfMailbox
            }) ?? messages.last
        }
    }

    fileprivate static func composeSeed(
        kind: DraftEditor.ComposeKind,
        account: EmailAccountDTO,
        thread: EmailThreadDTO,
        targetMessage: EmailMessageDTO
    ) -> (to: [String], cc: [String], subject: String, body: String) {
        let accountMailbox = account.emailAddress.lowercased()
        let sender = extractMailbox(targetMessage.from)
        let targetSubject = targetMessage.subject.isEmpty ? thread.subject : targetMessage.subject
        let sourceText = (targetMessage.bodyPreview.isEmpty ? targetMessage.snippet : targetMessage.bodyPreview)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        func uniqueAddresses(_ candidates: [String]) -> [String] {
            var seen = Set<String>()
            var result: [String] = []
            for candidate in candidates {
                guard let mailbox = extractMailbox(candidate) else { continue }
                let key = mailbox.lowercased()
                guard key != accountMailbox, seen.contains(key) == false else { continue }
                seen.insert(key)
                result.append(mailbox)
            }
            return result
        }

        let subject: String
        let to: [String]
        let cc: [String]

        switch kind {
        case .reply:
            subject = prefixedSubject(targetSubject, prefix: "Re:")
            to = uniqueAddresses(sender.map { [$0] } ?? [])
            cc = []
        case .replyAll:
            subject = prefixedSubject(targetSubject, prefix: "Re:")
            let senderAddresses = sender.map { [$0] } ?? []
            to = uniqueAddresses(senderAddresses + targetMessage.to)
            let toSet = Set(to.map { $0.lowercased() })
            cc = uniqueAddresses(targetMessage.cc).filter { toSet.contains($0.lowercased()) == false }
        case .forward:
            subject = prefixedForwardSubject(targetSubject)
            to = []
            cc = []
        }

        return (to, cc, subject, composeBody(kind: kind, message: targetMessage, sourceText: sourceText))
    }

    fileprivate static func prefixedSubject(_ subject: String, prefix: String) -> String {
        let trimmed = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return prefix }
        if trimmed.lowercased().hasPrefix(prefix.lowercased()) {
            return trimmed
        }
        return "\(prefix) \(trimmed)"
    }

    fileprivate static func prefixedForwardSubject(_ subject: String) -> String {
        let trimmed = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return "Fwd:" }
        let lowercased = trimmed.lowercased()
        if lowercased.hasPrefix("fwd:") || lowercased.hasPrefix("fw:") {
            return trimmed
        }
        return "Fwd: \(trimmed)"
    }

    fileprivate static func composeBody(
        kind: DraftEditor.ComposeKind,
        message: EmailMessageDTO,
        sourceText: String
    ) -> String {
        switch kind {
        case .reply, .replyAll:
            let quoted = sourceText
                .split(separator: "\n", omittingEmptySubsequences: false)
                .map { "> \($0)" }
                .joined(separator: "\n")
            return "\n\nOn \(message.receivedAt), \(message.from) wrote:\n\(quoted)"
        case .forward:
            var forwardedLines = [
                "",
                "",
                "---------- Forwarded message ---------",
                "From: \(message.from)",
                "Date: \(message.receivedAt)",
                "Subject: \(message.subject)",
                "To: \(message.to.joined(separator: ", "))",
            ]
            if message.cc.isEmpty == false {
                forwardedLines.append("Cc: \(message.cc.joined(separator: ", "))")
            }
            forwardedLines.append("")
            forwardedLines.append(sourceText)
            return forwardedLines.joined(separator: "\n")
        }
    }

    fileprivate static func isValidEmailAddress(_ value: String) -> Bool {
        let pattern = "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$"
        return value.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    fileprivate static func map(_ error: Error) -> APIError {
        (error as? APIError) ?? .transportUnavailable
    }
}
