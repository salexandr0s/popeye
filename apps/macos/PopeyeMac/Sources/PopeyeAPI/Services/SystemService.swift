import Foundation

public struct SystemService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadDashboardSnapshot() async throws -> DashboardSnapshot {
        async let status = client.status()
        async let scheduler = client.schedulerStatus()
        async let capabilities = client.engineCapabilities()
        async let usage = client.usageSummary()

        // Security audit may fail for readonly tokens — catch gracefully
        let audit = try? await client.securityAudit()
        // Memory audit is optional — won't break dashboard if memory isn't set up
        let memAudit = try? await client.memoryAudit()

        return DashboardSnapshot(
            status: try await status,
            scheduler: try await scheduler,
            capabilities: try await capabilities,
            usage: try await usage,
            securityAudit: audit,
            memoryAudit: memAudit
        )
    }


    public func loadWorkspaces() async throws -> [WorkspaceRecordDTO] {
        try await client.listWorkspaces()
    }

    public func loadHomeSummary(workspaceId: String) async throws -> HomeSummaryDTO {
        try await client.homeSummary(workspaceId: workspaceId)
    }

    // MARK: - Agent Profiles

    public func loadAgentProfiles() async throws -> [AgentProfileDTO] {
        try await client.listAgentProfiles()
    }

    public func loadAgentProfile(id: String) async throws -> AgentProfileDTO {
        try await client.getAgentProfile(id: id)
    }

    // MARK: - Identities

    public func loadIdentities(workspaceId: String) async throws -> [IdentityRecordDTO] {
        try await client.listIdentities(workspaceId: workspaceId)
    }

    public func loadDefaultIdentity(workspaceId: String) async throws -> WorkspaceIdentityDefaultDTO {
        try await client.getDefaultIdentity(workspaceId: workspaceId)
    }

    // MARK: - Instruction Previews

    public func loadInstructionPreview(scope: String) async throws -> InstructionPreviewDTO {
        try await client.instructionPreview(scope: scope)
    }
}
