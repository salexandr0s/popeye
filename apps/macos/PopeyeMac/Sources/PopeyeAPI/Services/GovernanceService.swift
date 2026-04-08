import Foundation

public struct GovernanceService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadInterventions() async throws -> [InterventionDTO] {
        try await client.listInterventions()
    }

    public func loadApprovals() async throws -> [ApprovalDTO] {
        try await client.listApprovals()
    }

    public func loadStandingApprovals(
        status: String? = nil,
        domain: String? = nil,
        actionKind: String? = nil
    ) async throws -> [StandingApprovalRecordDTO] {
        try await client.listStandingApprovals(status: status, domain: domain, actionKind: actionKind)
    }

    public func createStandingApproval(input: StandingApprovalCreateInput) async throws -> StandingApprovalRecordDTO {
        try await client.createStandingApproval(input: input)
    }

    public func revokeStandingApproval(id: String, revokedBy: String) async throws -> StandingApprovalRecordDTO {
        try await client.revokeStandingApproval(id: id, input: PolicyGrantRevokeInput(revokedBy: revokedBy))
    }

    public func loadAutomationGrants(
        status: String? = nil,
        domain: String? = nil,
        actionKind: String? = nil
    ) async throws -> [AutomationGrantRecordDTO] {
        try await client.listAutomationGrants(status: status, domain: domain, actionKind: actionKind)
    }

    public func createAutomationGrant(input: AutomationGrantCreateInput) async throws -> AutomationGrantRecordDTO {
        try await client.createAutomationGrant(input: input)
    }

    public func revokeAutomationGrant(id: String, revokedBy: String) async throws -> AutomationGrantRecordDTO {
        try await client.revokeAutomationGrant(id: id, input: PolicyGrantRevokeInput(revokedBy: revokedBy))
    }

    public func loadSecurityPolicy() async throws -> SecurityPolicyResponseDTO {
        try await client.securityPolicy()
    }

    public func loadVaults(domain: String? = nil) async throws -> [VaultRecordDTO] {
        try await client.listVaults(domain: domain)
    }

    public func loadVault(id: String) async throws -> VaultRecordDTO {
        try await client.getVault(id: id)
    }

    public func loadMutationReceipts(component: String? = nil, limit: Int = 10) async throws -> [MutationReceiptDTO] {
        try await client.listMutationReceipts(component: component, limit: limit)
    }
}
