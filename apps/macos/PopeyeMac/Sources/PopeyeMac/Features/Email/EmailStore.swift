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

        var mode: Mode
        var draftProviderDraftId: String?
        var accountId: String
        var toText: String
        var ccText: String
        var subject: String
        var body: String
    }

    struct Dependencies: Sendable {
        var loadAccounts: @Sendable () async throws -> [EmailAccountDTO]
        var loadThreads: @Sendable (_ accountId: String, _ limit: Int, _ unreadOnly: Bool) async throws -> [EmailThreadDTO]
        var loadThread: @Sendable (_ id: String) async throws -> EmailThreadDTO
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
            return
        }
        guard selectedThread?.id != id else { return }
        await loadThread(id: id)
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

    func loadThread(id: String) async {
        do {
            selectedThread = try await dependencies.loadThread(id)
        } catch {
            PopeyeLogger.refresh.error("Email thread load failed: \(error)")
        }
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
            body: ""
        )
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
                body: cachedBody
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
                body: detail.body
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
            selectedThread = try await dependencies.loadThread(selectedThreadID)
        } else {
            selectedThread = nil
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
            selectedThread = try await dependencies.loadThread(selectedThreadID)
        } else {
            selectedThread = nil
        }
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

    fileprivate static func isValidEmailAddress(_ value: String) -> Bool {
        let pattern = "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$"
        return value.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    fileprivate static func map(_ error: Error) -> APIError {
        (error as? APIError) ?? .transportUnavailable
    }
}
