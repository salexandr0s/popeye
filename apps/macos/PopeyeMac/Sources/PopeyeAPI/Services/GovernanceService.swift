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
}
