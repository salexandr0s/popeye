import Foundation
import PopeyeAPI

@Observable @MainActor
final class AutomationStore {
    enum ViewMode: String, CaseIterable {
        case list
        case week
    }

    enum Filter: String, CaseIterable {
        case all
        case needsAttention
        case heartbeat
        case scheduled

        var title: String {
            switch self {
            case .all: "All"
            case .needsAttention: "Needs Attention"
            case .heartbeat: "Heartbeat"
            case .scheduled: "Scheduled"
            }
        }
    }

    var automations: [AutomationRecordDTO] = []
    var selectedAutomationID: String?
    var selectedDetail: AutomationDetailDTO?
    var mutationReceipts: [MutationReceiptDTO] = []
    var isLoading = false
    var error: APIError?
    var viewMode: ViewMode = .list
    var filter: Filter = .all
    var searchText = ""
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            automations = []
            selectedAutomationID = nil
            selectedDetail = nil
            mutationReceipts = []
            error = nil
        }
    }

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let service: AutomationsService
    private let governanceService: GovernanceService

    init(client: ControlAPIClient) {
        self.service = AutomationsService(client: client)
        self.governanceService = GovernanceService(client: client)
    }

    var filteredAutomations: [AutomationRecordDTO] {
        automations.filter { automation in
            switch filter {
            case .all:
                true
            case .needsAttention:
                automation.status == "attention"
            case .heartbeat:
                automation.source == "heartbeat"
            case .scheduled:
                automation.source == "schedule"
            }
        }
        .filter { automation in
            let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard query.isEmpty == false else { return true }
            return automation.title.localizedStandardContains(query)
            || automation.scheduleSummary.localizedStandardContains(query)
            || automation.status.localizedStandardContains(query)
        }
        .sorted { lhs, rhs in
            let lhsDate = DateFormatting.parseISO8601(lhs.nextExpectedAt ?? lhs.lastRunAt ?? "") ?? .distantPast
            let rhsDate = DateFormatting.parseISO8601(rhs.nextExpectedAt ?? rhs.lastRunAt ?? "") ?? .distantPast
            return lhsDate > rhsDate
        }
    }

    func load() async {
        isLoading = true
        error = nil
        do {
            async let loadedAutomations = service.loadAutomations(workspaceId: workspaceID)
            async let loadedReceipts = governanceService.loadMutationReceipts(component: "automation", limit: 20)
            automations = try await loadedAutomations
            mutationReceipts = (try? await loadedReceipts) ?? []
            ensureSelection()
            if let selectedAutomationID {
                try? await loadDetail(id: selectedAutomationID)
            }
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
        isLoading = false
    }

    func loadDetail(id: String) async throws {
        selectedDetail = try await service.loadAutomation(id: id)
    }

    func ensureSelection() {
        guard let first = filteredAutomations.first else {
            selectedAutomationID = nil
            selectedDetail = nil
            return
        }

        if let selectedAutomationID,
           filteredAutomations.contains(where: { $0.id == selectedAutomationID }) {
            return
        }

        selectedAutomationID = first.id
    }

    var selectedMutationReceipt: MutationReceiptDTO? {
        guard let selectedAutomationID else { return nil }
        return mutationReceipts.first(where: { $0.metadata["automationId"] == selectedAutomationID })
    }

    func update(id: String, enabled: Bool? = nil, intervalSeconds: Int? = nil) async {
        await mutations.execute(
            action: { [service] in
                _ = try await service.update(id: id, input: AutomationUpdateInput(enabled: enabled, intervalSeconds: intervalSeconds))
            },
            successMessage: "Automation updated",
            fallbackError: "Update failed",
            reload: { [weak self] in
                await self?.load()
                if let self {
                    try? await self.loadDetail(id: id)
                }
            }
        )
    }

    func runNow(id: String) async {
        await mutations.execute(
            action: { [service] in _ = try await service.runNow(id: id) },
            successMessage: "Automation queued",
            fallbackError: "Run now failed",
            reload: { [weak self] in
                await self?.load()
                if let self {
                    try? await self.loadDetail(id: id)
                }
            }
        )
    }

    func pause(id: String) async {
        await mutations.execute(
            action: { [service] in _ = try await service.pause(id: id) },
            successMessage: "Automation paused",
            fallbackError: "Pause failed",
            reload: { [weak self] in
                await self?.load()
                if let self {
                    try? await self.loadDetail(id: id)
                }
            }
        )
    }

    func resume(id: String) async {
        await mutations.execute(
            action: { [service] in _ = try await service.resume(id: id) },
            successMessage: "Automation resumed",
            fallbackError: "Resume failed",
            reload: { [weak self] in
                await self?.load()
                if let self {
                    try? await self.loadDetail(id: id)
                }
            }
        )
    }

    func dismissMutation() {
        mutations.dismiss()
    }
}
