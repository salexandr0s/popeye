import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
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

    struct Dependencies: Sendable {
        var loadAutomations: @Sendable (_ workspaceID: String) async throws -> [AutomationRecordDTO]
        var loadAutomation: @Sendable (_ id: String) async throws -> AutomationDetailDTO
        var loadMutationReceipts: @Sendable (_ component: String?, _ limit: Int) async throws -> [MutationReceiptDTO]
        var updateAutomation: @Sendable (_ id: String, _ input: AutomationUpdateInput) async throws -> Void
        var runAutomationNow: @Sendable (_ id: String) async throws -> Void
        var pauseAutomation: @Sendable (_ id: String) async throws -> Void
        var resumeAutomation: @Sendable (_ id: String) async throws -> Void

        static func live(client: ControlAPIClient) -> Dependencies {
            let service = AutomationsService(client: client)
            let governanceService = GovernanceService(client: client)
            return Dependencies(
                loadAutomations: { workspaceID in
                    try await service.loadAutomations(workspaceId: workspaceID)
                },
                loadAutomation: { id in
                    try await service.loadAutomation(id: id)
                },
                loadMutationReceipts: { component, limit in
                    try await governanceService.loadMutationReceipts(component: component, limit: limit)
                },
                updateAutomation: { id, input in
                    _ = try await service.update(id: id, input: input)
                },
                runAutomationNow: { id in
                    _ = try await service.runNow(id: id)
                },
                pauseAutomation: { id in
                    _ = try await service.pause(id: id)
                },
                resumeAutomation: { id in
                    _ = try await service.resume(id: id)
                }
            )
        }
    }

    var automations: [AutomationRecordDTO] = []
    var selectedAutomationID: String?
    var selectedDetail: AutomationDetailDTO?
    var mutationReceipts: [MutationReceiptDTO] = []
    var viewMode: ViewMode = .list
    var filter: Filter = .all
    var searchText = ""
    var loadPhase: ScreenLoadPhase = .idle
    var detailPhase: ScreenOperationPhase = .idle
    var receiptsPhase: ScreenOperationPhase = .idle

    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            automations = []
            selectedAutomationID = nil
            selectedDetail = nil
            mutationReceipts = []
            loadPhase = .idle
            detailPhase = .idle
            receiptsPhase = .idle
            mutations.dismiss()
        }
    }

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
    var receiptsError: APIError? { receiptsPhase.error }
    var isMutating: Bool { mutationState == .executing }

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

    var selectedMutationReceipt: MutationReceiptDTO? {
        guard let selectedAutomationID else { return nil }
        return mutationReceipts.first(where: { $0.metadata["automationId"] == selectedAutomationID })
    }

    func load() async {
        loadPhase = .loading
        do {
            async let automationsTask = dependencies.loadAutomations(workspaceID)
            async let receiptsTask = dependencies.loadMutationReceipts("automation", 20)

            automations = try await automationsTask
            ensureSelection()
            loadPhase = automations.isEmpty ? .empty : .loaded

            do {
                mutationReceipts = try await receiptsTask
                receiptsPhase = .idle
            } catch {
                receiptsPhase = .failed(APIError.from(error))
            }

            if let selectedAutomationID {
                await loadDetail(id: selectedAutomationID)
            } else {
                selectedDetail = nil
                detailPhase = .idle
            }
        } catch {
            loadPhase = .failed(APIError.from(error))
        }
    }

    func loadDetail(id: String) async {
        detailPhase = .loading
        do {
            selectedDetail = try await dependencies.loadAutomation(id)
            detailPhase = .idle
        } catch {
            detailPhase = .failed(APIError.from(error))
        }
    }

    func loadMutationReceipts() async {
        receiptsPhase = .loading
        do {
            mutationReceipts = try await dependencies.loadMutationReceipts("automation", 20)
            receiptsPhase = .idle
        } catch {
            receiptsPhase = .failed(APIError.from(error))
        }
    }

    func ensureSelection() {
        guard let first = filteredAutomations.first else {
            selectedAutomationID = nil
            selectedDetail = nil
            detailPhase = .idle
            return
        }

        if let selectedAutomationID,
           filteredAutomations.contains(where: { $0.id == selectedAutomationID }) {
            return
        }

        selectedAutomationID = first.id
    }

    func update(id: String, enabled: Bool? = nil, intervalSeconds: Int? = nil) async {
        await mutations.execute(
            action: { [dependencies] in
                try await dependencies.updateAutomation(
                    id,
                    AutomationUpdateInput(enabled: enabled, intervalSeconds: intervalSeconds)
                )
            },
            successMessage: "Automation updated",
            fallbackError: "Update failed",
            reload: { [weak self] in
                guard let self else { return }
                await self.load()
                await self.loadDetail(id: id)
                await self.loadMutationReceipts()
            }
        )
    }

    func runNow(id: String) async {
        await mutations.execute(
            action: { [dependencies] in
                try await dependencies.runAutomationNow(id)
            },
            successMessage: "Automation queued",
            fallbackError: "Run now failed",
            reload: { [weak self] in
                guard let self else { return }
                await self.load()
                await self.loadDetail(id: id)
                await self.loadMutationReceipts()
            }
        )
    }

    func pause(id: String) async {
        await mutations.execute(
            action: { [dependencies] in
                try await dependencies.pauseAutomation(id)
            },
            successMessage: "Automation paused",
            fallbackError: "Pause failed",
            reload: { [weak self] in
                guard let self else { return }
                await self.load()
                await self.loadDetail(id: id)
                await self.loadMutationReceipts()
            }
        )
    }

    func resume(id: String) async {
        await mutations.execute(
            action: { [dependencies] in
                try await dependencies.resumeAutomation(id)
            },
            successMessage: "Automation resumed",
            fallbackError: "Resume failed",
            reload: { [weak self] in
                guard let self else { return }
                await self.load()
                await self.loadDetail(id: id)
                await self.loadMutationReceipts()
            }
        )
    }

    func dismissMutation() {
        mutations.dismiss()
    }
}
