import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class PlaybooksStore {
    enum Mode: String, CaseIterable {
        case playbooks
        case proposals
        case needsReview

        var title: String {
            switch self {
            case .playbooks: "Playbooks"
            case .proposals: "Proposals"
            case .needsReview: "Needs Review"
            }
        }
    }

    struct Dependencies: Sendable {
        var loadPlaybooks:
            @Sendable (
                _ query: String?, _ scope: String?, _ workspaceId: String, _ status: String?,
                _ limit: Int, _ offset: Int
            ) async throws -> [PlaybookRecordDTO]
        var loadPlaybook: @Sendable (_ id: String) async throws -> PlaybookDetailDTO
        var loadRevisions: @Sendable (_ id: String) async throws -> [PlaybookRevisionDTO]
        var loadUsage: @Sendable (_ id: String, _ limit: Int, _ offset: Int) async throws -> [PlaybookUsageRunDTO]
        var loadStaleCandidates: @Sendable () async throws -> [PlaybookStaleCandidateDTO]
        var loadProposals:
            @Sendable (
                _ query: String?, _ status: String?, _ kind: String?, _ scope: String?,
                _ sort: String?, _ limit: Int, _ offset: Int
            ) async throws -> [PlaybookProposalDTO]
        var loadProposal: @Sendable (_ id: String) async throws -> PlaybookProposalDTO
        var reviewProposal:
            @Sendable (_ id: String, _ decision: String, _ reviewedBy: String) async throws -> PlaybookProposalDTO
        var submitProposalForReview:
            @Sendable (_ id: String, _ submittedBy: String) async throws -> PlaybookProposalDTO
        var applyProposal:
            @Sendable (_ id: String, _ appliedBy: String) async throws -> PlaybookProposalDTO
        var activatePlaybook:
            @Sendable (_ id: String, _ updatedBy: String) async throws -> PlaybookDetailDTO
        var retirePlaybook:
            @Sendable (_ id: String, _ updatedBy: String) async throws -> PlaybookDetailDTO

        static func live(client: ControlAPIClient) -> Dependencies {
            let service = PlaybooksService(client: client)
            return Dependencies(
                loadPlaybooks: { query, scope, workspaceId, status, limit, offset in
                    try await service.loadPlaybooks(
                        query: query,
                        scope: scope,
                        workspaceId: workspaceId,
                        status: status,
                        limit: limit,
                        offset: offset)
                },
                loadPlaybook: { id in try await service.loadPlaybook(id: id) },
                loadRevisions: { id in try await service.loadRevisions(id: id) },
                loadUsage: { id, limit, offset in try await service.loadUsage(id: id, limit: limit, offset: offset) },
                loadStaleCandidates: { try await service.loadStaleCandidates() },
                loadProposals: { query, status, kind, scope, sort, limit, offset in
                    try await service.loadProposals(
                        query: query,
                        status: status,
                        kind: kind,
                        scope: scope,
                        sort: sort,
                        limit: limit,
                        offset: offset)
                },
                loadProposal: { id in try await service.loadProposal(id: id) },
                reviewProposal: { id, decision, reviewedBy in
                    try await service.reviewProposal(id: id, decision: decision, reviewedBy: reviewedBy)
                },
                submitProposalForReview: { id, submittedBy in
                    try await service.submitProposalForReview(id: id, submittedBy: submittedBy)
                },
                applyProposal: { id, appliedBy in
                    try await service.applyProposal(id: id, appliedBy: appliedBy)
                },
                activatePlaybook: { id, updatedBy in
                    try await service.activatePlaybook(id: id, updatedBy: updatedBy)
                },
                retirePlaybook: { id, updatedBy in
                    try await service.retirePlaybook(id: id, updatedBy: updatedBy)
                }
            )
        }
    }

    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            resetState()
        }
    }

    var mode: Mode = .playbooks
    var searchText = ""
    var playbookScopeFilter = "all"
    var playbookStatusFilter = "all"
    var proposalStatusFilter = "all"
    var proposalKindFilter = "all"
    var proposalScopeFilter = "all"

    var playbooks: [PlaybookRecordDTO] = []
    var staleCandidates: [PlaybookStaleCandidateDTO] = []
    var proposals: [PlaybookProposalDTO] = []
    var selectedPlaybookRecordID: String?
    var selectedProposalID: String?
    var selectedPlaybookDetail: PlaybookDetailDTO?
    var selectedProposalDetail: PlaybookProposalDTO?
    var revisions: [PlaybookRevisionDTO] = []
    var usage: [PlaybookUsageRunDTO] = []

    var loadPhase: ScreenLoadPhase = .idle
    var detailPhase: ScreenOperationPhase = .idle

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

    var selectedStaleCandidate: PlaybookStaleCandidateDTO? {
        guard mode == .needsReview, let selectedPlaybookRecordID else { return nil }
        return staleCandidates.first(where: { $0.recordId == selectedPlaybookRecordID })
    }

    func load() async {
        loadPhase = .loading
        do {
            switch mode {
            case .playbooks:
                async let playbooksTask = dependencies.loadPlaybooks(
                    trimmedSearchText,
                    playbookScopeFilter == "all" ? nil : playbookScopeFilter,
                    workspaceID,
                    playbookStatusFilter == "all" ? nil : playbookStatusFilter,
                    26,
                    0)
                async let staleTask = dependencies.loadStaleCandidates()
                let (loadedPlaybooks, loadedStale) = try await (playbooksTask, staleTask)
                playbooks = loadedPlaybooks
                staleCandidates = loadedStale
                ensureSelection()
                loadPhase = playbooks.isEmpty ? .empty : .loaded
                await loadSelectedDetail()
            case .proposals:
                async let proposalsTask = dependencies.loadProposals(
                    trimmedSearchText,
                    proposalStatusFilter == "all" ? nil : proposalStatusFilter,
                    proposalKindFilter == "all" ? nil : proposalKindFilter,
                    proposalScopeFilter == "all" ? nil : proposalScopeFilter,
                    "created_desc",
                    26,
                    0)
                async let staleTask = dependencies.loadStaleCandidates()
                let (loadedProposals, loadedStale) = try await (proposalsTask, staleTask)
                proposals = loadedProposals
                staleCandidates = loadedStale
                ensureSelection()
                loadPhase = proposals.isEmpty ? .empty : .loaded
                await loadSelectedDetail()
            case .needsReview:
                staleCandidates = try await dependencies.loadStaleCandidates()
                ensureSelection()
                loadPhase = staleCandidates.isEmpty ? .empty : .loaded
                await loadSelectedDetail()
            }
        } catch {
            loadPhase = .failed(APIError.from(error))
        }
    }

    func didChangeMode() async {
        await load()
    }

    func revealAppliedPlaybook(id: String, scope: String) async {
        mode = .playbooks
        playbookScopeFilter = scope
        searchText = id
        await load()
        if let match = playbooks.first(where: { $0.playbookId == id && $0.scope == scope }) {
            selectedPlaybookRecordID = match.recordId
            await loadSelectedPlaybookDetail()
        }
    }

    func revealPlaybookRecord(id: String) async {
        mode = .playbooks
        selectedPlaybookRecordID = id
        await load()
    }

    func loadSelectedDetail() async {
        switch mode {
        case .playbooks, .needsReview:
            await loadSelectedPlaybookDetail()
        case .proposals:
            await loadSelectedProposalDetail()
        }
    }

    func loadSelectedPlaybookDetail() async {
        guard let selectedPlaybookRecordID else {
            selectedPlaybookDetail = nil
            revisions = []
            usage = []
            return
        }

        detailPhase = .loading
        do {
            async let detailTask = dependencies.loadPlaybook(selectedPlaybookRecordID)
            async let revisionsTask = dependencies.loadRevisions(selectedPlaybookRecordID)
            async let usageTask = dependencies.loadUsage(selectedPlaybookRecordID, 10, 0)
            let (detail, loadedRevisions, loadedUsage) = try await (detailTask, revisionsTask, usageTask)
            selectedPlaybookDetail = detail
            revisions = loadedRevisions
            usage = loadedUsage
            detailPhase = .idle
        } catch {
            detailPhase = .failed(APIError.from(error))
        }
    }

    func loadSelectedProposalDetail() async {
        guard let selectedProposalID else {
            selectedProposalDetail = nil
            return
        }

        detailPhase = .loading
        do {
            selectedProposalDetail = try await dependencies.loadProposal(selectedProposalID)
            detailPhase = .idle
        } catch {
            detailPhase = .failed(APIError.from(error))
        }
    }

    func approveSelectedProposal() async {
        await reviewSelectedProposal(decision: "approved", successMessage: "Playbook proposal approved")
    }

    func rejectSelectedProposal() async {
        await reviewSelectedProposal(decision: "rejected", successMessage: "Playbook proposal rejected")
    }

    func submitSelectedProposalForReview() async {
        guard let selectedProposalID else { return }
        await mutations.execute(
            action: {
                self.selectedProposalDetail = try await self.dependencies.submitProposalForReview(selectedProposalID, "native-app")
            },
            successMessage: "Playbook proposal submitted",
            fallbackError: "Submit proposal failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func applySelectedProposal() async {
        guard let selectedProposalID else { return }
        var appliedRecordID: String?
        await mutations.execute(
            action: {
                let proposal = try await self.dependencies.applyProposal(selectedProposalID, "native-app")
                self.selectedProposalDetail = proposal
                appliedRecordID = proposal.appliedRecordId
            },
            successMessage: "Playbook proposal applied",
            fallbackError: "Apply proposal failed",
            reload: { [weak self] in
                guard let self else { return }
                if let appliedRecordID {
                    self.mode = .playbooks
                    self.selectedPlaybookRecordID = appliedRecordID
                }
                await self.load()
            }
        )
    }

    func activateSelectedPlaybook() async {
        guard let selectedPlaybookRecordID else { return }
        await mutations.execute(
            action: {
                self.selectedPlaybookDetail = try await self.dependencies.activatePlaybook(selectedPlaybookRecordID, "native-app")
            },
            successMessage: "Playbook activated",
            fallbackError: "Activate playbook failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func retireSelectedPlaybook() async {
        guard let selectedPlaybookRecordID else { return }
        await mutations.execute(
            action: {
                self.selectedPlaybookDetail = try await self.dependencies.retirePlaybook(selectedPlaybookRecordID, "native-app")
            },
            successMessage: "Playbook retired",
            fallbackError: "Retire playbook failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func dismissMutation() {
        mutations.dismiss()
    }

    private var trimmedSearchText: String? {
        let value = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func reviewSelectedProposal(decision: String, successMessage: String) async {
        guard let selectedProposalID else { return }
        await mutations.execute(
            action: {
                self.selectedProposalDetail = try await self.dependencies.reviewProposal(selectedProposalID, decision, "native-app")
            },
            successMessage: successMessage,
            fallbackError: "Review proposal failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    private func ensureSelection() {
        switch mode {
        case .playbooks:
            if playbooks.contains(where: { $0.recordId == selectedPlaybookRecordID }) == false {
                selectedPlaybookRecordID = playbooks.first?.recordId
            }
        case .proposals:
            if proposals.contains(where: { $0.id == selectedProposalID }) == false {
                selectedProposalID = proposals.first?.id
            }
        case .needsReview:
            if staleCandidates.contains(where: { $0.recordId == selectedPlaybookRecordID }) == false {
                selectedPlaybookRecordID = staleCandidates.first?.recordId
            }
        }
    }

    private func resetState() {
        playbooks = []
        staleCandidates = []
        proposals = []
        selectedPlaybookRecordID = nil
        selectedProposalID = nil
        selectedPlaybookDetail = nil
        selectedProposalDetail = nil
        revisions = []
        usage = []
        loadPhase = .idle
        detailPhase = .idle
        mutations.dismiss()
    }
}
