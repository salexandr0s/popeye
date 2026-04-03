import Foundation
import PopeyeAPI

@Observable @MainActor
final class MemoryStore {
    enum ViewMode: String, CaseIterable {
        case search
        case browse
        case daily
        case curated
    }

    // MARK: - State

    var viewMode: ViewMode = .search
    var searchText = ""
    var searchResults: MemorySearchResponseDTO?
    var memories: [MemoryRecordDTO] = []
    var selectedMemoryId: String?
    var selectedDayID: String?
    var selectedDetail: MemoryRecordDTO?
    var memoryHistory: MemoryHistoryDTO?
    var isLoading = false
    var isSearching = false
    var errorMessage: String?

    // Filters (browse mode)
    var typeFilter: String?

    // Mutations
    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    // Promotion
    var promotionProposal: MemoryPromotionProposalDTO?

    private let memoryService: MemoryService
    private let client: ControlAPIClient
    let curatedDocuments: CuratedDocumentsStore
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            searchResults = nil
            selectedMemoryId = nil
            selectedDetail = nil
            memoryHistory = nil
            selectedDayID = nil
            curatedDocuments.workspaceID = workspaceID
        }
    }

    init(client: ControlAPIClient) {
        self.client = client
        self.memoryService = MemoryService(client: client)
        self.curatedDocuments = CuratedDocumentsStore(
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

    // MARK: - Computed

    var selectedMemory: MemoryRecordDTO? {
        guard let id = selectedMemoryId else { return nil }
        if let detail = selectedDetail, detail.id == id { return detail }
        return memories.first(where: { $0.id == id })
    }

    var selectedHistory: MemoryHistoryDTO? {
        guard let id = selectedMemoryId,
              let history = memoryHistory,
              history.memoryId == id
        else { return nil }

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

    // MARK: - Actions

    func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        isSearching = true
        errorMessage = nil
        do {
            searchResults = try await memoryService.search(query: query, workspaceId: workspaceID)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            PopeyeLogger.refresh.error("Memory search failed: \(error)")
        }
        isSearching = false
    }

    func loadList() async {
        isLoading = true
        do {
            memories = try await memoryService.listMemories(workspaceId: workspaceID, limit: 200)
            ensureSelectedDay()
        } catch {
            PopeyeLogger.refresh.error("Memory list load failed: \(error)")
        }
        isLoading = false
    }

    func loadDetail(id: String) async {
        do {
            selectedDetail = try await memoryService.getMemory(id: id)
        } catch {
            PopeyeLogger.refresh.error("Memory detail load failed: \(error)")
        }
    }

    func loadHistory(id: String) async {
        do {
            memoryHistory = try await memoryService.getHistory(id: id)
        } catch {
            PopeyeLogger.refresh.error("Memory history load failed: \(error)")
        }
    }

    // MARK: - Mutations

    func pinMemory(id: String, targetKind: String, reason: String? = nil) async {
        await mutations.execute(
            action: { [client] in _ = try await client.pinMemory(id: id, targetKind: targetKind, reason: reason) },
            successMessage: "Memory pinned",
            fallbackError: "Pin failed",
            reload: { [weak self] in await self?.loadList() }
        )
    }

    func forgetMemory(id: String, reason: String? = nil) async {
        await mutations.execute(
            action: { [client] in _ = try await client.forgetMemory(id: id, reason: reason) },
            successMessage: "Memory forgotten",
            fallbackError: "Forget failed",
            reload: { [weak self] in
                await self?.loadList()
                if self?.selectedMemoryId == id {
                    self?.selectedMemoryId = nil
                    self?.selectedDetail = nil
                }
            }
        )
    }

    func proposePromotion(id: String, targetPath: String) async {
        do {
            promotionProposal = try await memoryService.proposePromotion(id: id, targetPath: targetPath)
        } catch let error as APIError {
            errorMessage = error.userMessage
        } catch {
            PopeyeLogger.refresh.error("Promotion proposal failed: \(error)")
        }
    }

    func executePromotion() async {
        guard let proposal = promotionProposal else { return }
        await mutations.execute(
            action: { [client] in
                let input = MemoryPromotionExecuteInput(
                    targetPath: proposal.targetPath,
                    diff: proposal.diff
                )
                _ = try await client.executePromotion(id: proposal.memoryId, input: input)
            },
            successMessage: "Memory promoted to curated file",
            fallbackError: "Promotion failed",
            reload: { [weak self] in
                self?.promotionProposal = nil
                await self?.loadList()
            }
        )
    }

    func dismissMutation() { mutations.dismiss() }

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
        guard let group = dayGroups.first(where: { group in group.memories.contains(where: { $0.id == memoryID }) }) else { return }
        selectedDayID = group.id
    }

    func loadCuratedDocumentsIfNeeded() async {
        await curatedDocuments.loadIfNeeded()
    }
}
