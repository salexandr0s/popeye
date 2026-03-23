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

        return DashboardSnapshot(
            status: try await status,
            scheduler: try await scheduler,
            capabilities: try await capabilities,
            usage: try await usage,
            securityAudit: audit
        )
    }
}
