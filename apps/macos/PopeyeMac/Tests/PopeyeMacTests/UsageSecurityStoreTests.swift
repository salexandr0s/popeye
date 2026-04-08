import Foundation
import Testing

@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("Usage & Security Store")
struct UsageSecurityStoreTests {
    @Test("Load hydrates governance sections alongside usage and receipts")
    func loadHydratesGovernanceSections() async {
        let store = UsageSecurityStore(dependencies: .stub())

        await store.load()

        #expect(store.usage?.runs == 42)
        #expect(store.securityAudit?.findings.count == 1)
        #expect(store.controlChanges.count == 1)
        #expect(store.standingApprovals.count == 1)
        #expect(store.automationGrants.count == 1)
        #expect(store.securityPolicy?.approvalRules.count == 1)
        #expect(store.vaults.count == 1)
        #expect(store.standingApprovalsPhase == .idle)
        #expect(store.automationGrantsPhase == .idle)
        #expect(store.securityPolicyPhase == .idle)
        #expect(store.vaultsPhase == .idle)
    }

    @Test("Creating a standing approval refreshes grants, receipts, and invalidations")
    func createStandingApprovalRefreshesState() async {
        let standingBox = ValueBox([sampleStandingApproval()])
        let receiptBox = ValueBox([sampleMutationReceipt(id: "receipt-1", summary: "Initial state")])
        let invalidations = SignalBox()

        let store = UsageSecurityStore(
            dependencies: .stub(
                loadMutationReceipts: { await receiptBox.get() },
                loadStandingApprovals: { await standingBox.get() },
                createStandingApproval: { input in
                    #expect(input.resourceType == "repo")
                    let created = sampleStandingApproval(
                        id: "grant-2",
                        resourceType: input.resourceType,
                        resourceId: input.resourceId,
                        requestedBy: input.requestedBy,
                        note: input.note ?? "",
                        status: "active"
                    )
                    await standingBox.set([sampleStandingApproval(), created])
                    await receiptBox.set([sampleMutationReceipt(id: "receipt-2", summary: "Standing approval created")])
                    return created
                },
                emitInvalidation: { signal in
                    invalidations.append(signal)
                }
            )
        )

        await store.load()
        store.standingApprovalDraft.resourceType = "repo"
        store.standingApprovalDraft.resourceId = "nb/popeye"
        store.standingApprovalDraft.requestedBy = "operator"
        store.standingApprovalDraft.note = "Safe repository write"

        await store.createStandingApproval()

        #expect(store.standingApprovals.count == 2)
        #expect(store.controlChanges.first?.summary == "Standing approval created")
        #expect(store.standingApprovalDraft == UsageSecurityStore.PolicyGrantDraft.standingApproval)
        #expect(store.mutationState == MutationState.succeeded("Standing approval created"))
        let emitted = invalidations.get()
        #expect(emitted.contains(.approvals))
        #expect(emitted.contains(.security))
        #expect(emitted.contains(.receipts))
    }

    @Test("Revoking an automation grant refreshes only that section and leaves policy readable")
    func revokeAutomationGrantRefreshesState() async {
        let grantBox = ValueBox([sampleAutomationGrant()])
        let store = UsageSecurityStore(
            dependencies: .stub(
                loadAutomationGrants: { await grantBox.get() },
                revokeAutomationGrant: { id, revokedBy in
                    #expect(id == "grant-automation-1")
                    #expect(revokedBy == "macos_app")
                    let revoked = sampleAutomationGrant(status: "revoked", revokedBy: revokedBy)
                    await grantBox.set([revoked])
                    return revoked
                }
            )
        )

        await store.load()
        await store.revokeAutomationGrant(id: "grant-automation-1")

        #expect(store.automationGrants.first?.status == "revoked")
        #expect(store.mutationState == .succeeded("Automation grant revoked"))
        #expect(store.securityPolicy?.defaultRiskClass == "ask")
    }

    @Test("Policy load failures stay local to the policy section")
    func policyFailuresStayLocal() async {
        struct SampleError: Error {}
        let store = UsageSecurityStore(
            dependencies: .stub(
                loadSecurityPolicy: { throw SampleError() }
            )
        )

        await store.load()

        #expect(store.standingApprovalsPhase == .idle)
        #expect(store.automationGrantsPhase == .idle)
        #expect(store.vaultsPhase == .idle)
        #expect(store.securityPolicy == nil)
        #expect(store.securityPolicyPhase.error != nil)
        #expect(store.standingApprovals.count == 1)
    }
}

extension UsageSecurityStore.Dependencies {
    static func stub(
        loadDashboardSnapshot: @escaping @Sendable () async throws -> DashboardSnapshot = { sampleDashboardSnapshot() },
        loadMutationReceipts: @escaping @Sendable () async throws -> [MutationReceiptDTO] = { [sampleMutationReceipt(id: "receipt-1", summary: "Security policy applied")] },
        loadStandingApprovals: @escaping @Sendable () async throws -> [StandingApprovalRecordDTO] = { [sampleStandingApproval()] },
        createStandingApproval: @escaping @Sendable (_ input: StandingApprovalCreateInput) async throws -> StandingApprovalRecordDTO = { input in
            sampleStandingApproval(resourceType: input.resourceType, resourceId: input.resourceId, requestedBy: input.requestedBy, note: input.note ?? "")
        },
        revokeStandingApproval: @escaping @Sendable (_ id: String, _ revokedBy: String) async throws -> StandingApprovalRecordDTO = { _, revokedBy in
            sampleStandingApproval(status: "revoked", revokedBy: revokedBy)
        },
        loadAutomationGrants: @escaping @Sendable () async throws -> [AutomationGrantRecordDTO] = { [sampleAutomationGrant()] },
        createAutomationGrant: @escaping @Sendable (_ input: AutomationGrantCreateInput) async throws -> AutomationGrantRecordDTO = { input in
            sampleAutomationGrant(resourceType: input.resourceType, resourceId: input.resourceId, requestedBy: input.requestedBy, note: input.note ?? "")
        },
        revokeAutomationGrant: @escaping @Sendable (_ id: String, _ revokedBy: String) async throws -> AutomationGrantRecordDTO = { _, revokedBy in
            sampleAutomationGrant(status: "revoked", revokedBy: revokedBy)
        },
        loadSecurityPolicy: @escaping @Sendable () async throws -> SecurityPolicyResponseDTO = { sampleSecurityPolicy() },
        loadVaults: @escaping @Sendable () async throws -> [VaultRecordDTO] = { [sampleVault()] },
        emitInvalidation: @escaping @Sendable (_ signal: InvalidationSignal) -> Void = { _ in }
    ) -> Self {
        Self(
            loadDashboardSnapshot: loadDashboardSnapshot,
            loadMutationReceipts: loadMutationReceipts,
            loadStandingApprovals: loadStandingApprovals,
            createStandingApproval: createStandingApproval,
            revokeStandingApproval: revokeStandingApproval,
            loadAutomationGrants: loadAutomationGrants,
            createAutomationGrant: createAutomationGrant,
            revokeAutomationGrant: revokeAutomationGrant,
            loadSecurityPolicy: loadSecurityPolicy,
            loadVaults: loadVaults,
            emitInvalidation: emitInvalidation
        )
    }
}


private final class SignalBox: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [InvalidationSignal] = []

    func append(_ signal: InvalidationSignal) {
        lock.lock()
        values.append(signal)
        lock.unlock()
    }

    func get() -> [InvalidationSignal] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }
}
private actor ValueBox<Value> {
    private var value: Value

    init(_ value: Value) {
        self.value = value
    }

    func get() -> Value {
        value
    }

    func set(_ value: Value) {
        self.value = value
    }

    func append(_ element: InvalidationSignal) where Value == [InvalidationSignal] {
        value.append(element)
    }
}

private func sampleDashboardSnapshot() -> DashboardSnapshot {
    DashboardSnapshot(
        status: DaemonStatusDTO(
            ok: true,
            runningJobs: 1,
            queuedJobs: 0,
            openInterventions: 0,
            activeLeases: 1,
            engineKind: "pi",
            schedulerRunning: true,
            startedAt: "2026-04-08T09:00:00Z",
            lastShutdownAt: nil
        ),
        scheduler: SchedulerStatusDTO(
            running: true,
            activeLeases: 1,
            activeRuns: 1,
            nextHeartbeatDueAt: "2026-04-08T10:00:00Z"
        ),
        capabilities: EngineCapabilitiesDTO(
            engineKind: "pi",
            persistentSessionSupport: true,
            resumeBySessionRefSupport: true,
            hostToolMode: "native",
            compactionEventSupport: true,
            cancellationMode: "rpc_abort",
            acceptedRequestMetadata: [],
            warnings: []
        ),
        usage: UsageSummaryDTO(runs: 42, tokensIn: 150_000, tokensOut: 80_000, estimatedCostUsd: 3.45),
        securityAudit: SecurityAuditDTO(findings: [
            SecurityAuditFindingDTO(
                code: "policy_info",
                severity: "info",
                message: "Policy posture healthy",
                component: "security",
                timestamp: "2026-04-08T10:00:00Z",
                details: nil
            )
        ])
    )
}

private func sampleMutationReceipt(id: String, summary: String) -> MutationReceiptDTO {
    MutationReceiptDTO(
        id: id,
        kind: "policy",
        component: "security",
        status: "succeeded",
        summary: summary,
        details: "Governance mutation recorded",
        actorRole: "operator",
        workspaceId: "default",
        usage: ReceiptUsageDTO(
            provider: "openai",
            model: "gpt-5.4-mini",
            tokensIn: 0,
            tokensOut: 0,
            estimatedCostUsd: 0
        ),
        metadata: [:],
        createdAt: "2026-04-08T10:00:00Z"
    )
}

private func sampleStandingApproval(
    id: String = "grant-standing-1",
    resourceType: String = "repo",
    resourceId: String? = "nb/popeye",
    requestedBy: String? = "operator",
    note: String = "Repository allowlist",
    status: String = "active",
    revokedBy: String? = nil
) -> StandingApprovalRecordDTO {
    StandingApprovalRecordDTO(
        id: id,
        scope: "external_write",
        domain: "github",
        actionKind: "write",
        resourceScope: "resource",
        resourceType: resourceType,
        resourceId: resourceId,
        requestedBy: requestedBy,
        workspaceId: "default",
        projectId: nil,
        note: note,
        expiresAt: "2026-05-01T00:00:00Z",
        createdBy: "macos_app",
        status: status,
        createdAt: "2026-04-08T10:00:00Z",
        revokedAt: status == "revoked" ? "2026-04-09T10:00:00Z" : nil,
        revokedBy: revokedBy
    )
}

private func sampleAutomationGrant(
    id: String = "grant-automation-1",
    resourceType: String = "mailbox",
    resourceId: String? = "Inbox",
    requestedBy: String? = "heartbeat",
    note: String = "Daily digest grant",
    status: String = "active",
    revokedBy: String? = nil
) -> AutomationGrantRecordDTO {
    AutomationGrantRecordDTO(
        id: id,
        scope: "external_write",
        domain: "email",
        actionKind: "digest",
        resourceScope: "workspace",
        resourceType: resourceType,
        resourceId: resourceId,
        requestedBy: requestedBy,
        workspaceId: "default",
        projectId: nil,
        note: note,
        expiresAt: nil,
        createdBy: "macos_app",
        taskSources: ["heartbeat", "schedule"],
        status: status,
        createdAt: "2026-04-08T10:00:00Z",
        revokedAt: status == "revoked" ? "2026-04-09T10:00:00Z" : nil,
        revokedBy: revokedBy
    )
}

private func sampleSecurityPolicy() -> SecurityPolicyResponseDTO {
    SecurityPolicyResponseDTO(
        domainPolicies: [
            DomainPolicyDTO(domain: "github", sensitivity: "personal", embeddingPolicy: "derived_only", contextReleasePolicy: "summary")
        ],
        approvalRules: [
            ApprovalPolicyRuleDTO(scope: "external_write", domain: "github", riskClass: "ask", actionKinds: ["write"], resourceScopes: ["resource"])
        ],
        defaultRiskClass: "ask",
        actionDefaults: [
            ActionPolicyDefaultDTO(
                scope: "external_write",
                domain: "github",
                actionKind: "write",
                riskClass: "ask",
                standingApprovalEligible: true,
                automationGrantEligible: false,
                reason: "GitHub writes require operator posture"
            )
        ]
    )
}

private func sampleVault() -> VaultRecordDTO {
    VaultRecordDTO(
        id: "vault-1",
        domain: "finance",
        kind: "restricted",
        dbPath: "/Users/operator/Library/Application Support/Popeye/vaults/finance.db",
        encrypted: true,
        encryptionKeyRef: "keychain:finance",
        status: "closed",
        createdAt: "2026-04-01T08:00:00Z",
        lastAccessedAt: "2026-04-08T09:00:00Z"
    )
}
