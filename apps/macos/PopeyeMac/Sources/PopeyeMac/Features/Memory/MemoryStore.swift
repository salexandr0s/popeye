import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class MemoryStore {
    enum ViewMode: String, CaseIterable {
        case search
        case browse
        case daily
        case curated
    }

    struct Dependencies: Sendable {
        var listMemories: @Sendable (_ workspaceID: String, _ limit: Int) async throws -> [MemoryRecordDTO]
        var searchMemories: @Sendable (_ workspaceID: String, _ query: String, _ limit: Int) async throws -> MemorySearchResponseDTO
        var loadMemoryDetail: @Sendable (_ id: String) async throws -> MemoryRecordDTO
        var loadMemoryHistory: @Sendable (_ id: String) async throws -> MemoryHistoryDTO
        var pinMemory: @Sendable (_ id: String, _ targetKind: String, _ reason: String?) async throws -> Void
        var forgetMemory: @Sendable (_ id: String, _ reason: String?) async throws -> Void
        var proposePromotion: @Sendable (_ id: String, _ targetPath: String) async throws -> MemoryPromotionProposalDTO
        var executePromotion: @Sendable (_ id: String, _ input: MemoryPromotionExecuteInput) async throws -> Void

        static func live(client: ControlAPIClient) -> Dependencies {
            Dependencies(
                listMemories: { workspaceID, limit in
                    try await client.listMemories(workspaceId: workspaceID, limit: limit)
                },
                searchMemories: { workspaceID, query, limit in
                    try await client.searchMemories(query: query, limit: limit, workspaceId: workspaceID)
                },
                loadMemoryDetail: { id in
                    try await client.getMemory(id: id)
                },
                loadMemoryHistory: { id in
                    try await client.getMemoryHistory(id: id)
                },
                pinMemory: { id, targetKind, reason in
                    _ = try await client.pinMemory(id: id, targetKind: targetKind, reason: reason)
                },
                forgetMemory: { id, reason in
                    _ = try await client.forgetMemory(id: id, reason: reason)
                },
                proposePromotion: { id, targetPath in
                    try await client.proposePromotion(id: id, targetPath: targetPath)
                },
                executePromotion: { id, input in
                    _ = try await client.executePromotion(id: id, input: input)
                }
            )
        }
    }

    var viewMode: ViewMode = .search
    var searchText = ""
    var searchResults: MemorySearchResponseDTO?
    var memories: [MemoryRecordDTO] = []
    var selectedMemoryId: String?
    var selectedDayID: String?
    var selectedDetail: MemoryRecordDTO?
    var memoryHistory: MemoryHistoryDTO?
    var typeFilter: String?
    var promotionProposal: MemoryPromotionProposalDTO?

    var loadPhase: ScreenLoadPhase = .idle
    var searchPhase: ScreenOperationPhase = .idle
    var detailPhase: ScreenOperationPhase = .idle
    var historyPhase: ScreenOperationPhase = .idle
    var promotionProposalPhase: ScreenOperationPhase = .idle

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }
    let curatedDocuments: CuratedDocumentsStore

    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            searchResults = nil
            selectedMemoryId = nil
            selectedDetail = nil
            memoryHistory = nil
            selectedDayID = nil
            promotionProposal = nil
            loadPhase = .idle
            searchPhase = .idle
            detailPhase = .idle
            historyPhase = .idle
            promotionProposalPhase = .idle
            curatedDocuments.workspaceID = workspaceID
            mutations.dismiss()
        }
    }

    private let dependencies: Dependencies

    init(client: ControlAPIClient) {
        self.dependencies = .live(client: client)
        self.curatedDocuments = Self.makeCuratedDocumentsStore(client: client)
    }

    init(
        dependencies: Dependencies,
        curatedDocuments: CuratedDocumentsStore? = nil
    ) {
        self.dependencies = dependencies
        self.curatedDocuments = curatedDocuments ?? Self.makeCuratedDocumentsStore(client: Self.previewClient)
    }

    var error: APIError? { loadPhase.error }
    var searchError: APIError? { searchPhase.error }
    var detailError: APIError? { detailPhase.error }
    var historyError: APIError? { historyPhase.error }
    var promotionProposalError: APIError? { promotionProposalPhase.error }

    var selectedMemory: MemoryRecordDTO? {
        guard let id = selectedMemoryId else { return nil }
        if let detail = selectedDetail, detail.id == id { return detail }
        return memories.first(where: { $0.id == id })
    }

    var selectedHistory: MemoryHistoryDTO? {
        guard let id = selectedMemoryId,
              let history = memoryHistory,
              history.memoryId == id
        else {
            return nil
        }

        return history
    }

    var isMutating: Bool {
        mutationState == .executing
    }

    var filteredMemories: [MemoryRecordDTO] {
        var result = memories
        if let filter = typeFilter {
            result = result.filter { $0.memoryType == filter }
        }
        return result
    }

    var availableTypes: [String] {
        Array(Set(memories.map(\.memoryType))).sorted()
    }

    var dayGroups: [MemoryDayGroup] {
        MemoryDayGrouper.group(memories: filteredMemories)
    }

    var selectedDayGroup: MemoryDayGroup? {
        if let selectedDayID {
            return dayGroups.first { $0.id == selectedDayID }
        }
        return dayGroups.first
    }

    func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            searchResults = nil
            searchPhase = .idle
            return
        }

        searchPhase = .loading
        do {
            searchResults = try await dependencies.searchMemories(workspaceID, query, 20)
            searchPhase = .idle
        } catch {
            searchPhase = .failed(APIError.from(error))
        }
    }

    func loadList() async {
        loadPhase = .loading
        do {
            memories = try await dependencies.listMemories(workspaceID, 200)
            ensureSelectedDay()
            if let selectedMemoryId, !memories.contains(where: { $0.id == selectedMemoryId }) {
                self.selectedMemoryId = nil
                selectedDetail = nil
                memoryHistory = nil
                detailPhase = .idle
                historyPhase = .idle
            }
            loadPhase = memories.isEmpty ? .empty : .loaded
        } catch {
            loadPhase = .failed(APIError.from(error))
        }
    }

    func loadDetail(id: String) async {
        detailPhase = .loading
        do {
            selectedDetail = try await dependencies.loadMemoryDetail(id)
            detailPhase = .idle
        } catch {
            detailPhase = .failed(APIError.from(error))
        }
    }

    func loadHistory(id: String) async {
        historyPhase = .loading
        do {
            memoryHistory = try await dependencies.loadMemoryHistory(id)
            historyPhase = .idle
        } catch {
            historyPhase = .failed(APIError.from(error))
        }
    }

    func pinMemory(id: String, targetKind: String, reason: String? = nil) async {
        await mutations.execute(
            action: { [dependencies] in
                try await dependencies.pinMemory(id, targetKind, reason)
            },
            successMessage: "Memory pinned",
            fallbackError: "Pin failed",
            reload: { [weak self] in
                guard let self else { return }
                await self.loadList()
                if self.selectedMemoryId == id {
                    await self.loadDetail(id: id)
                    await self.loadHistory(id: id)
                }
            }
        )
    }

    func forgetMemory(id: String, reason: String? = nil) async {
        await mutations.execute(
            action: { [dependencies] in
                try await dependencies.forgetMemory(id, reason)
            },
            successMessage: "Memory forgotten",
            fallbackError: "Forget failed",
            reload: { [weak self] in
                guard let self else { return }
                await self.loadList()
                if self.selectedMemoryId == id {
                    self.selectedMemoryId = nil
                    self.selectedDetail = nil
                    self.memoryHistory = nil
                    self.detailPhase = .idle
                    self.historyPhase = .idle
                }
            }
        )
    }

    func proposePromotion(id: String, targetPath: String) async {
        promotionProposalPhase = .loading
        do {
            promotionProposal = try await dependencies.proposePromotion(id, targetPath)
            promotionProposalPhase = .idle
        } catch {
            promotionProposalPhase = .failed(APIError.from(error))
        }
    }

    func executePromotion() async {
        guard let proposal = promotionProposal else { return }
        let input = MemoryPromotionExecuteInput(
            targetPath: proposal.targetPath,
            diff: proposal.diff,
            approved: true,
            promoted: true
        )

        await mutations.execute(
            action: { [dependencies] in
                try await dependencies.executePromotion(proposal.memoryId, input)
            },
            successMessage: "Memory promoted to curated file",
            fallbackError: "Promotion failed",
            reload: { [weak self] in
                guard let self else { return }
                self.promotionProposal = nil
                self.promotionProposalPhase = .idle
                await self.loadList()
                if let selectedMemoryId = self.selectedMemoryId {
                    await self.loadDetail(id: selectedMemoryId)
                    await self.loadHistory(id: selectedMemoryId)
                }
            }
        )
    }

    func dismissMutation() {
        mutations.dismiss()
    }

    func ensureSelectedDay() {
        guard let firstDayID = dayGroups.first?.id else {
            selectedDayID = nil
            return
        }

        if selectedDayID == nil || dayGroups.contains(where: { $0.id == selectedDayID }) == false {
            selectedDayID = firstDayID
        }
    }

    func selectDay(for memoryID: String?) {
        guard let memoryID else { return }
        guard let group = dayGroups.first(where: { group in
            group.memories.contains(where: { $0.id == memoryID })
        }) else {
            return
        }
        selectedDayID = group.id
    }

    func loadCuratedDocumentsIfNeeded() async {
        await curatedDocuments.loadIfNeeded()
    }

    private static let previewClient = ControlAPIClient(
        baseURL: "http://127.0.0.1:1",
        token: "preview"
    )

    private static func makeCuratedDocumentsStore(client: ControlAPIClient) -> CuratedDocumentsStore {
        CuratedDocumentsStore(
            client: client,
            allowedKinds: [
                "curated_memory",
                "daily_memory_note",
            ],
            preferredKinds: [
                "daily_memory_note",
                "curated_memory",
            ]
        )
    }
}
