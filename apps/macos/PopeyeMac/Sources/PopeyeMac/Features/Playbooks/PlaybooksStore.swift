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

    enum AuthoringSessionKind: String, Sendable {
        case newDraft
        case newPatch
        case editDraft
    }

    struct ProposalEditor: Equatable, Sendable {
        var sessionKind: AuthoringSessionKind
        var proposalID: String?
        var proposalStatus: String?
        var kind: String
        var playbookId: String
        var scope: String
        var workspaceId: String
        var projectId: String
        var title: String
        var allowedProfileIdsText: String
        var summary: String
        var body: String
        var targetRecordId: String?
        var baseRevisionHash: String?
        var sourceLabel: String

        var isPatch: Bool { kind == "patch" }
        var isDraft: Bool { kind == "draft" }
        var isPersisted: Bool { proposalID != nil }
        var canUseSuggestedSeed: Bool { sessionKind == .newPatch && isPatch }
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
        var loadWorkspaces: @Sendable () async throws -> [WorkspaceRecordDTO]
        var loadProjects: @Sendable () async throws -> [ProjectRecordDTO]
        var createDraftProposal: @Sendable (_ input: PlaybookProposalCreateDraftInput) async throws -> PlaybookProposalDTO
        var createPatchProposal: @Sendable (_ input: PlaybookProposalCreatePatchInput) async throws -> PlaybookProposalDTO
        var updateProposal: @Sendable (_ id: String, _ input: PlaybookProposalUpdateInput) async throws -> PlaybookProposalDTO
        var suggestPatch: @Sendable (_ id: String, _ proposedBy: String) async throws -> PlaybookProposalDTO
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
                loadWorkspaces: { try await service.loadWorkspaces() },
                loadProjects: { try await service.loadProjects() },
                createDraftProposal: { input in try await service.createDraftProposal(input: input) },
                createPatchProposal: { input in try await service.createPatchProposal(input: input) },
                updateProposal: { id, input in try await service.updateProposal(id: id, input: input) },
                suggestPatch: { id, proposedBy in try await service.suggestPatch(id: id, proposedBy: proposedBy) },
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
    var workspaces: [WorkspaceRecordDTO] = []
    var projects: [ProjectRecordDTO] = []
    var selectedPlaybookRecordID: String?
    var selectedProposalID: String?
    var selectedPlaybookDetail: PlaybookDetailDTO?
    var selectedProposalDetail: PlaybookProposalDTO?
    var revisions: [PlaybookRevisionDTO] = []
    var usage: [PlaybookUsageRunDTO] = []
    var editor: ProposalEditor?
    var editorErrorMessage: String?

    var loadPhase: ScreenLoadPhase = .idle
    var detailPhase: ScreenOperationPhase = .idle

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let dependencies: Dependencies
    private var editorBaseline: ProposalEditor?

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

    var availableProjectsForEditor: [ProjectRecordDTO] {
        guard let editor else { return [] }
        return projects.filter { $0.workspaceId == editor.workspaceId }
    }

    var isAuthoring: Bool { editor != nil }
    var canEditSelectedDraft: Bool { selectedProposalDetail?.status == "drafting" }
    var canDraftPatchFromSelection: Bool { selectedPlaybookDetail != nil }
    var canDraftRepairFromSelection: Bool { selectedStaleCandidate != nil && selectedPlaybookDetail != nil }
    var isEditorDirty: Bool { editor != nil && editor != editorBaseline }

    var editorValidationMessage: String? {
        guard let editor else { return nil }
        if editor.isDraft {
            if editor.playbookId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "Playbook ID is required."
            }
            if editor.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "Title is required."
            }
            if editor.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "Body is required."
            }
            if editor.scope != "global" && editor.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "Workspace selection is required for this scope."
            }
            if editor.scope == "project" && editor.projectId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "Project selection is required for project-scoped drafts."
            }
        } else {
            if editor.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "Title is required."
            }
            if editor.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "Body is required."
            }
            if (editor.targetRecordId ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "A canonical playbook target is required for patch proposals."
            }
        }
        return nil
    }

    func load() async {
        loadPhase = .loading
        do {
            async let workspacesTask: [WorkspaceRecordDTO] = { (try? await self.dependencies.loadWorkspaces()) ?? [] }()
            async let projectsTask: [ProjectRecordDTO] = { (try? await self.dependencies.loadProjects()) ?? [] }()

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
                let (loadedPlaybooks, loadedStale, loadedWorkspaces, loadedProjects) = try await (
                    playbooksTask,
                    staleTask,
                    workspacesTask,
                    projectsTask
                )
                playbooks = loadedPlaybooks
                staleCandidates = loadedStale
                workspaces = loadedWorkspaces
                projects = loadedProjects
                normalizeEditorIfNeeded()
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
                let (loadedProposals, loadedStale, loadedWorkspaces, loadedProjects) = try await (
                    proposalsTask,
                    staleTask,
                    workspacesTask,
                    projectsTask
                )
                proposals = loadedProposals
                staleCandidates = loadedStale
                workspaces = loadedWorkspaces
                projects = loadedProjects
                normalizeEditorIfNeeded()
                ensureSelection()
                loadPhase = proposals.isEmpty ? .empty : .loaded
                await loadSelectedDetail()
            case .needsReview:
                async let staleTask = dependencies.loadStaleCandidates()
                let (loadedStale, loadedWorkspaces, loadedProjects) = try await (
                    staleTask,
                    workspacesTask,
                    projectsTask
                )
                staleCandidates = loadedStale
                workspaces = loadedWorkspaces
                projects = loadedProjects
                normalizeEditorIfNeeded()
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

    func startNewDraftAuthoring() {
        editorErrorMessage = nil
        let workspaceSelection = defaultWorkspaceSelection()
        let nextEditor = ProposalEditor(
            sessionKind: .newDraft,
            proposalID: nil,
            proposalStatus: "drafting",
            kind: "draft",
            playbookId: "",
            scope: "workspace",
            workspaceId: workspaceSelection,
            projectId: defaultProjectSelection(for: workspaceSelection),
            title: "",
            allowedProfileIdsText: "",
            summary: "",
            body: "",
            targetRecordId: nil,
            baseRevisionHash: nil,
            sourceLabel: workspaceSelection
        )
        setEditor(nextEditor)
    }

    func startPatchDraftAuthoring() {
        guard let playbook = selectedPlaybookDetail else { return }
        editorErrorMessage = nil
        setEditor(makePatchEditor(from: playbook, summary: seedRepairSummary()))
    }

    func startRepairDraftForSelectedCandidate() {
        guard let playbook = selectedPlaybookDetail else { return }
        editorErrorMessage = nil
        setEditor(makePatchEditor(from: playbook, summary: seedRepairSummary()))
    }

    func editSelectedDraft() {
        guard let proposal = selectedProposalDetail, proposal.status == "drafting" else { return }
        editorErrorMessage = nil
        setEditor(makeEditor(from: proposal))
    }

    func suggestPatchForSelectedPlaybook() async {
        guard let selectedPlaybookRecordID else { return }
        editorErrorMessage = nil
        await mutations.execute(
            action: {
                let proposal = try await self.dependencies.suggestPatch(selectedPlaybookRecordID, "native-app")
                self.mode = .proposals
                self.selectedProposalID = proposal.id
                self.selectedProposalDetail = proposal
                self.proposals = [proposal] + self.proposals.filter { $0.id != proposal.id }
                if proposal.status == "drafting" {
                    self.setEditor(self.makeEditor(from: proposal))
                } else {
                    self.clearEditor()
                }
            },
            successMessage: "Patch proposal drafted",
            fallbackError: "Patch suggestion failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func saveAuthoringDraft() async {
        guard let editor else { return }
        if let validationMessage = editorValidationMessage {
            editorErrorMessage = validationMessage
            return
        }

        let successMessage = editor.isPersisted ? "Playbook draft saved" : "Playbook draft created"
        await mutations.execute(
            action: {
                let proposal = try await self.persistEditor(editor)
                self.mode = .proposals
                self.selectedProposalID = proposal.id
                self.selectedProposalDetail = proposal
                self.setEditor(self.makeEditor(from: proposal))
            },
            successMessage: successMessage,
            fallbackError: "Save draft failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func submitAuthoringDraftForReview() async {
        guard let editor else { return }
        if let validationMessage = editorValidationMessage {
            editorErrorMessage = validationMessage
            return
        }

        await mutations.execute(
            action: {
                let persisted = try await self.persistEditor(editor)
                let submitted = try await self.dependencies.submitProposalForReview(persisted.id, "native-app")
                self.mode = .proposals
                self.selectedProposalID = submitted.id
                self.selectedProposalDetail = submitted
                self.clearEditor()
            },
            successMessage: "Playbook proposal submitted",
            fallbackError: "Submit proposal failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func cancelAuthoring() {
        clearEditor()
    }

    func updateEditorTitle(_ value: String) { updateEditor { $0.title = value } }
    func updateEditorPlaybookID(_ value: String) { updateEditor { $0.playbookId = value } }
    func updateEditorAllowedProfilesText(_ value: String) { updateEditor { $0.allowedProfileIdsText = value } }
    func updateEditorSummary(_ value: String) { updateEditor { $0.summary = value } }
    func updateEditorBody(_ value: String) { updateEditor { $0.body = value } }
    func updateEditorScope(_ value: String) { updateEditor { $0.scope = value } }
    func updateEditorWorkspaceID(_ value: String) { updateEditor { $0.workspaceId = value } }
    func updateEditorProjectID(_ value: String) { updateEditor { $0.projectId = value } }

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

    private func persistEditor(_ editor: ProposalEditor) async throws -> PlaybookProposalDTO {
        let allowedProfileIds = parseAllowedProfileIDs(editor.allowedProfileIdsText)
        let summary = editor.summary.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = editor.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = editor.body.trimmingCharacters(in: .whitespacesAndNewlines)

        let proposal: PlaybookProposalDTO
        if let proposalID = editor.proposalID {
            proposal = try await dependencies.updateProposal(
                proposalID,
                PlaybookProposalUpdateInput(
                    title: title,
                    allowedProfileIds: allowedProfileIds,
                    summary: summary,
                    body: body,
                    updatedBy: "native-app"))
        } else if editor.isDraft {
            let workspaceId = editor.scope == "global" ? nil : nilIfEmpty(editor.workspaceId)
            let projectId = editor.scope == "project" ? nilIfEmpty(editor.projectId) : nil
            proposal = try await dependencies.createDraftProposal(
                PlaybookProposalCreateDraftInput(
                    playbookId: editor.playbookId.trimmingCharacters(in: .whitespacesAndNewlines),
                    scope: editor.scope,
                    workspaceId: workspaceId,
                    projectId: projectId,
                    title: title,
                    allowedProfileIds: allowedProfileIds,
                    body: body,
                    summary: summary))
        } else {
            proposal = try await dependencies.createPatchProposal(
                PlaybookProposalCreatePatchInput(
                    targetRecordId: editor.targetRecordId ?? "",
                    baseRevisionHash: nilIfEmpty(editor.baseRevisionHash),
                    title: title,
                    allowedProfileIds: allowedProfileIds,
                    body: body,
                    summary: summary))
        }
        return proposal
    }

    private func updateEditor(_ apply: (inout ProposalEditor) -> Void) {
        guard var editor else { return }
        apply(&editor)
        setEditor(normalize(editor), resetBaseline: false)
    }

    private func setEditor(_ editor: ProposalEditor, resetBaseline: Bool = true) {
        let normalized = normalize(editor)
        self.editor = normalized
        if resetBaseline {
            self.editorBaseline = normalized
        }
        editorErrorMessage = nil
    }

    private func clearEditor() {
        editor = nil
        editorBaseline = nil
        editorErrorMessage = nil
    }

    private func normalizeEditorIfNeeded() {
        guard let editor else { return }
        let normalized = normalize(editor)
        self.editor = normalized
        if editorBaseline != nil {
            self.editorBaseline = normalize(editorBaseline ?? normalized)
        }
    }

    private func normalize(_ editor: ProposalEditor) -> ProposalEditor {
        guard editor.isDraft else { return editor }
        var normalized = editor
        switch normalized.scope {
        case "global":
            normalized.workspaceId = ""
            normalized.projectId = ""
        case "workspace":
            if normalized.workspaceId.isEmpty {
                normalized.workspaceId = defaultWorkspaceSelection()
            }
            normalized.projectId = ""
        case "project":
            if normalized.workspaceId.isEmpty {
                normalized.workspaceId = defaultWorkspaceSelection()
            }
            let availableProjects = projects.filter { $0.workspaceId == normalized.workspaceId }
            if availableProjects.contains(where: { $0.id == normalized.projectId }) == false {
                normalized.projectId = availableProjects.first?.id ?? ""
            }
        default:
            normalized.scope = "workspace"
            normalized.workspaceId = defaultWorkspaceSelection()
            normalized.projectId = ""
        }
        return normalized
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
        workspaces = []
        projects = []
        selectedPlaybookRecordID = nil
        selectedProposalID = nil
        selectedPlaybookDetail = nil
        selectedProposalDetail = nil
        revisions = []
        usage = []
        clearEditor()
        loadPhase = .idle
        detailPhase = .idle
        mutations.dismiss()
    }

    private func defaultWorkspaceSelection() -> String {
        if workspaces.contains(where: { $0.id == workspaceID }) {
            return workspaceID
        }
        return workspaces.first?.id ?? workspaceID
    }

    private func defaultProjectSelection(for workspaceId: String) -> String {
        projects.first(where: { $0.workspaceId == workspaceId })?.id ?? ""
    }

    private func parseAllowedProfileIDs(_ value: String) -> [String] {
        Array(
            Set(
                value
                    .split(separator: ",")
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
            )
        )
        .sorted()
    }

    private func nilIfEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func seedRepairSummary() -> String {
        guard let candidate = selectedStaleCandidate else { return "" }
        let interventionLabel = candidate.interventions30d == 1 ? "intervention" : "interventions"
        let normalizedReasons = candidate.reasons
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: #"\.$"#, with: "", options: .regularExpression) }
            .filter { !$0.isEmpty }
        let reasonsSuffix = normalizedReasons.isEmpty ? "" : " Reasons: \(normalizedReasons.joined(separator: ", "))."
        return "Stale follow-up: \(candidate.useCount30d) uses / \(candidate.failedRuns30d) failed runs / \(candidate.interventions30d) \(interventionLabel) in trailing 30 days.\(reasonsSuffix)"
    }

    private func makePatchEditor(from playbook: PlaybookDetailDTO, summary: String) -> ProposalEditor {
        ProposalEditor(
            sessionKind: .newPatch,
            proposalID: nil,
            proposalStatus: "drafting",
            kind: "patch",
            playbookId: playbook.playbookId,
            scope: playbook.scope,
            workspaceId: playbook.workspaceId ?? "",
            projectId: playbook.projectId ?? "",
            title: playbook.title,
            allowedProfileIdsText: playbook.allowedProfileIds.joined(separator: ", "),
            summary: summary,
            body: playbook.body,
            targetRecordId: playbook.recordId,
            baseRevisionHash: playbook.currentRevisionHash,
            sourceLabel: playbook.recordId
        )
    }

    private func makeEditor(from proposal: PlaybookProposalDTO) -> ProposalEditor {
        ProposalEditor(
            sessionKind: .editDraft,
            proposalID: proposal.id,
            proposalStatus: proposal.status,
            kind: proposal.kind,
            playbookId: proposal.playbookId,
            scope: proposal.scope,
            workspaceId: proposal.workspaceId ?? "",
            projectId: proposal.projectId ?? "",
            title: proposal.title,
            allowedProfileIdsText: proposal.allowedProfileIds.joined(separator: ", "),
            summary: proposal.summary,
            body: proposal.body,
            targetRecordId: proposal.targetRecordId,
            baseRevisionHash: proposal.baseRevisionHash,
            sourceLabel: proposal.targetRecordId ?? proposal.playbookId
        )
    }
}
