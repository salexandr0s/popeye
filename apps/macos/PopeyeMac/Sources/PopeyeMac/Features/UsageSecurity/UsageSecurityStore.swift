import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class UsageSecurityStore {
    enum BusyKey: Equatable {
        case createStandingApproval
        case revokeStandingApproval(String)
        case createAutomationGrant
        case revokeAutomationGrant(String)
    }

    enum ApprovalScopeOption: String, CaseIterable, Identifiable {
        case secretAccess = "secret_access"
        case vaultOpen = "vault_open"
        case contextRelease = "context_release"
        case dataSourceConnect = "data_source_connect"
        case externalWrite = "external_write"

        var id: String { rawValue }
    }

    enum DomainOption: String, CaseIterable, Identifiable {
        case general
        case email
        case calendar
        case todos
        case github
        case files
        case people
        case finance
        case medical
        case coding

        var id: String { rawValue }
    }

    enum ActionOption: String, CaseIterable, Identifiable {
        case read
        case search
        case sync
        case `import`
        case digest
        case classify
        case triage
        case draft
        case connect
        case releaseContext = "release_context"
        case openVault = "open_vault"
        case write
        case send
        case delete

        var id: String { rawValue }
    }

    enum StatusFilter: String, CaseIterable, Identifiable {
        case all
        case active
        case revoked
        case expired

        var id: String { rawValue }
    }

    struct PolicyGrantDraft: Equatable {
        var scope: ApprovalScopeOption
        var domain: DomainOption
        var actionKind: ActionOption
        var resourceType = ""
        var resourceId = ""
        var requestedBy = ""
        var workspaceId = ""
        var projectId = ""
        var expiresAt = ""
        var note = ""

        var isValid: Bool {
            !resourceType.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        static let standingApproval = PolicyGrantDraft(
            scope: .externalWrite,
            domain: .general,
            actionKind: .write
        )

        static let automationGrant = PolicyGrantDraft(
            scope: .externalWrite,
            domain: .general,
            actionKind: .digest
        )
    }

    struct Dependencies: Sendable {
        var loadDashboardSnapshot: @Sendable () async throws -> DashboardSnapshot
        var loadMutationReceipts: @Sendable () async throws -> [MutationReceiptDTO]
        var loadStandingApprovals: @Sendable () async throws -> [StandingApprovalRecordDTO]
        var createStandingApproval: @Sendable (_ input: StandingApprovalCreateInput) async throws -> StandingApprovalRecordDTO
        var revokeStandingApproval: @Sendable (_ id: String, _ revokedBy: String) async throws -> StandingApprovalRecordDTO
        var loadAutomationGrants: @Sendable () async throws -> [AutomationGrantRecordDTO]
        var createAutomationGrant: @Sendable (_ input: AutomationGrantCreateInput) async throws -> AutomationGrantRecordDTO
        var revokeAutomationGrant: @Sendable (_ id: String, _ revokedBy: String) async throws -> AutomationGrantRecordDTO
        var loadSecurityPolicy: @Sendable () async throws -> SecurityPolicyResponseDTO
        var loadVaults: @Sendable () async throws -> [VaultRecordDTO]
        var emitInvalidation: @Sendable (_ signal: InvalidationSignal) -> Void

        static func live(client: ControlAPIClient) -> Dependencies {
            let systemService = SystemService(client: client)
            let governanceService = GovernanceService(client: client)
            return Dependencies(
                loadDashboardSnapshot: { try await systemService.loadDashboardSnapshot() },
                loadMutationReceipts: { try await governanceService.loadMutationReceipts(limit: 8) },
                loadStandingApprovals: { try await governanceService.loadStandingApprovals() },
                createStandingApproval: { input in
                    try await governanceService.createStandingApproval(input: input)
                },
                revokeStandingApproval: { id, revokedBy in
                    try await governanceService.revokeStandingApproval(id: id, revokedBy: revokedBy)
                },
                loadAutomationGrants: { try await governanceService.loadAutomationGrants() },
                createAutomationGrant: { input in
                    try await governanceService.createAutomationGrant(input: input)
                },
                revokeAutomationGrant: { id, revokedBy in
                    try await governanceService.revokeAutomationGrant(id: id, revokedBy: revokedBy)
                },
                loadSecurityPolicy: { try await governanceService.loadSecurityPolicy() },
                loadVaults: { try await governanceService.loadVaults() },
                emitInvalidation: { signal in
                    NotificationCenter.default.post(name: .popeyeInvalidation, object: signal)
                }
            )
        }
    }

    var usage: UsageSummaryDTO?
    var securityAudit: SecurityAuditDTO?
    var controlChanges: [MutationReceiptDTO] = []
    var standingApprovals: [StandingApprovalRecordDTO] = []
    var automationGrants: [AutomationGrantRecordDTO] = []
    var securityPolicy: SecurityPolicyResponseDTO?
    var vaults: [VaultRecordDTO] = []

    var isLoading = false
    var standingApprovalsPhase: ScreenOperationPhase = .idle
    var automationGrantsPhase: ScreenOperationPhase = .idle
    var securityPolicyPhase: ScreenOperationPhase = .idle
    var vaultsPhase: ScreenOperationPhase = .idle
    var busyKey: BusyKey?

    var standingApprovalDraft = PolicyGrantDraft.standingApproval
    var automationGrantDraft = PolicyGrantDraft.automationGrant

    var standingApprovalStatusFilter: StatusFilter = .all
    var standingApprovalDomainFilter: DomainOption?
    var standingApprovalActionFilter: ActionOption?

    var automationGrantStatusFilter: StatusFilter = .all
    var automationGrantDomainFilter: DomainOption?
    var automationGrantActionFilter: ActionOption?

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let dependencies: Dependencies

    init(client: ControlAPIClient) {
        self.dependencies = .live(client: client)
    }

    init(dependencies: Dependencies) {
        self.dependencies = dependencies
    }

    var filteredStandingApprovals: [StandingApprovalRecordDTO] {
        standingApprovals.filter { record in
            if standingApprovalStatusFilter != .all && record.status != standingApprovalStatusFilter.rawValue {
                return false
            }
            if let domain = standingApprovalDomainFilter, record.domain != domain.rawValue {
                return false
            }
            if let action = standingApprovalActionFilter, record.actionKind != action.rawValue {
                return false
            }
            return true
        }
    }

    var filteredAutomationGrants: [AutomationGrantRecordDTO] {
        automationGrants.filter { record in
            if automationGrantStatusFilter != .all && record.status != automationGrantStatusFilter.rawValue {
                return false
            }
            if let domain = automationGrantDomainFilter, record.domain != domain.rawValue {
                return false
            }
            if let action = automationGrantActionFilter, record.actionKind != action.rawValue {
                return false
            }
            return true
        }
    }

    var activeStandingApprovalCount: Int {
        standingApprovals.count(where: { $0.status == StatusFilter.active.rawValue })
    }

    var activeAutomationGrantCount: Int {
        automationGrants.count(where: { $0.status == StatusFilter.active.rawValue })
    }

    var openVaultCount: Int {
        vaults.count(where: { $0.status == "open" })
    }

    var encryptedVaultCount: Int {
        vaults.count(where: \.encrypted)
    }

    var canCreateStandingApproval: Bool {
        standingApprovalDraft.isValid && !isBusy(.createStandingApproval)
    }

    var canCreateAutomationGrant: Bool {
        automationGrantDraft.isValid && !isBusy(.createAutomationGrant)
    }

    func load() async {
        isLoading = true
        standingApprovalsPhase = .loading
        automationGrantsPhase = .loading
        securityPolicyPhase = .loading
        vaultsPhase = .loading

        async let snapshotResult = capture { try await dependencies.loadDashboardSnapshot() }
        async let receiptsResult = capture { try await dependencies.loadMutationReceipts() }
        async let standingApprovalsResult = capture { try await dependencies.loadStandingApprovals() }
        async let automationGrantsResult = capture { try await dependencies.loadAutomationGrants() }
        async let securityPolicyResult = capture { try await dependencies.loadSecurityPolicy() }
        async let vaultsResult = capture { try await dependencies.loadVaults() }

        switch await snapshotResult {
        case .success(let snapshot):
            usage = snapshot.usage
            securityAudit = snapshot.securityAudit
        case .failure(let error):
            PopeyeLogger.refresh.error("Usage/Security snapshot load failed: \(error)")
        }

        switch await receiptsResult {
        case .success(let receipts):
            controlChanges = receipts
        case .failure(let error):
            PopeyeLogger.refresh.error("Usage/Security receipts load failed: \(error)")
        }

        apply(await standingApprovalsResult, to: &standingApprovals, phase: &standingApprovalsPhase, context: "standing approvals")
        apply(await automationGrantsResult, to: &automationGrants, phase: &automationGrantsPhase, context: "automation grants")
        switch await securityPolicyResult {
        case .success(let policy):
            securityPolicy = policy
            securityPolicyPhase = .idle
        case .failure(let error):
            securityPolicyPhase = .failed(APIError.from(error))
            PopeyeLogger.refresh.error("Usage/Security security policy load failed: \(error)")
        }
        apply(await vaultsResult, to: &vaults, phase: &vaultsPhase, context: "vaults")

        isLoading = false
    }

    func refreshStandingApprovals() async {
        standingApprovalsPhase = .loading
        apply(await capture { try await dependencies.loadStandingApprovals() }, to: &standingApprovals, phase: &standingApprovalsPhase, context: "standing approvals")
    }

    func refreshAutomationGrants() async {
        automationGrantsPhase = .loading
        apply(await capture { try await dependencies.loadAutomationGrants() }, to: &automationGrants, phase: &automationGrantsPhase, context: "automation grants")
    }

    func refreshSecurityPolicy() async {
        securityPolicyPhase = .loading
        switch await capture({ try await dependencies.loadSecurityPolicy() }) {
        case .success(let policy):
            securityPolicy = policy
            securityPolicyPhase = .idle
        case .failure(let error):
            securityPolicyPhase = .failed(APIError.from(error))
            PopeyeLogger.refresh.error("Usage/Security security policy load failed: \(error)")
        }
    }

    func refreshVaults() async {
        vaultsPhase = .loading
        apply(await capture { try await dependencies.loadVaults() }, to: &vaults, phase: &vaultsPhase, context: "vaults")
    }

    func createStandingApproval() async {
        guard canCreateStandingApproval else { return }
        busyKey = .createStandingApproval
        let input = buildStandingApprovalInput(from: standingApprovalDraft)

        await mutations.execute(
            action: { [dependencies] in
                _ = try await dependencies.createStandingApproval(input)
                self.standingApprovalDraft = .standingApproval
            },
            successMessage: "Standing approval created",
            fallbackError: "Standing approval creation failed",
            reload: { [weak self] in
                await self?.postGovernanceMutationReload(refreshStandingApprovals: true, refreshAutomationGrants: false)
            }
        )
        busyKey = nil
    }

    func revokeStandingApproval(id: String) async {
        guard !isBusy(.revokeStandingApproval(id)) else { return }
        busyKey = .revokeStandingApproval(id)
        await mutations.execute(
            action: { [dependencies] in
                _ = try await dependencies.revokeStandingApproval(id, "macos_app")
            },
            successMessage: "Standing approval revoked",
            fallbackError: "Standing approval revoke failed",
            reload: { [weak self] in
                await self?.postGovernanceMutationReload(refreshStandingApprovals: true, refreshAutomationGrants: false)
            }
        )
        busyKey = nil
    }

    func createAutomationGrant() async {
        guard canCreateAutomationGrant else { return }
        busyKey = .createAutomationGrant
        let input = buildAutomationGrantInput(from: automationGrantDraft)

        await mutations.execute(
            action: { [dependencies] in
                _ = try await dependencies.createAutomationGrant(input)
                self.automationGrantDraft = .automationGrant
            },
            successMessage: "Automation grant created",
            fallbackError: "Automation grant creation failed",
            reload: { [weak self] in
                await self?.postGovernanceMutationReload(refreshStandingApprovals: false, refreshAutomationGrants: true)
            }
        )
        busyKey = nil
    }

    func revokeAutomationGrant(id: String) async {
        guard !isBusy(.revokeAutomationGrant(id)) else { return }
        busyKey = .revokeAutomationGrant(id)
        await mutations.execute(
            action: { [dependencies] in
                _ = try await dependencies.revokeAutomationGrant(id, "macos_app")
            },
            successMessage: "Automation grant revoked",
            fallbackError: "Automation grant revoke failed",
            reload: { [weak self] in
                await self?.postGovernanceMutationReload(refreshStandingApprovals: false, refreshAutomationGrants: true)
            }
        )
        busyKey = nil
    }

    func dismissMutation() {
        mutations.dismiss()
    }

    func isBusy(_ key: BusyKey) -> Bool {
        busyKey == key
    }

    private func postGovernanceMutationReload(
        refreshStandingApprovals shouldRefreshStandingApprovals: Bool,
        refreshAutomationGrants shouldRefreshAutomationGrants: Bool
    ) async {
        if shouldRefreshStandingApprovals {
            await refreshStandingApprovals()
        }
        if shouldRefreshAutomationGrants {
            await refreshAutomationGrants()
        }
        controlChanges = (try? await dependencies.loadMutationReceipts()) ?? controlChanges
        dependencies.emitInvalidation(.approvals)
        dependencies.emitInvalidation(.security)
        dependencies.emitInvalidation(.receipts)
    }

    private func buildStandingApprovalInput(from draft: PolicyGrantDraft) -> StandingApprovalCreateInput {
        StandingApprovalCreateInput(
            scope: draft.scope.rawValue,
            domain: draft.domain.rawValue,
            actionKind: draft.actionKind.rawValue,
            resourceType: draft.resourceType.trimmed,
            resourceId: draft.resourceId.trimmedNil,
            requestedBy: draft.requestedBy.trimmedNil,
            workspaceId: draft.workspaceId.trimmedNil,
            projectId: draft.projectId.trimmedNil,
            note: draft.note.trimmedNil,
            expiresAt: draft.expiresAt.trimmedNil,
            createdBy: "macos_app"
        )
    }

    private func buildAutomationGrantInput(from draft: PolicyGrantDraft) -> AutomationGrantCreateInput {
        AutomationGrantCreateInput(
            scope: draft.scope.rawValue,
            domain: draft.domain.rawValue,
            actionKind: draft.actionKind.rawValue,
            resourceType: draft.resourceType.trimmed,
            resourceId: draft.resourceId.trimmedNil,
            requestedBy: draft.requestedBy.trimmedNil,
            workspaceId: draft.workspaceId.trimmedNil,
            projectId: draft.projectId.trimmedNil,
            note: draft.note.trimmedNil,
            expiresAt: draft.expiresAt.trimmedNil,
            createdBy: "macos_app"
        )
    }

    private func apply<T>(
        _ result: Result<T, Error>,
        to value: inout T,
        phase: inout ScreenOperationPhase,
        context: String
    ) {
        switch result {
        case .success(let loaded):
            value = loaded
            phase = .idle
        case .failure(let error):
            phase = .failed(APIError.from(error))
            PopeyeLogger.refresh.error("Usage/Security \(context) load failed: \(error)")
        }
    }

    private func capture<T>(_ operation: () async throws -> T) async -> Result<T, Error> {
        do {
            return .success(try await operation())
        } catch {
            return .failure(error)
        }
    }
}

extension String {
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var trimmedNil: String? {
        let value = trimmed
        return value.isEmpty ? nil : value
    }

    var humanizedForPolicyUI: String {
        replacingOccurrences(of: "_", with: " ").capitalized
    }
}
