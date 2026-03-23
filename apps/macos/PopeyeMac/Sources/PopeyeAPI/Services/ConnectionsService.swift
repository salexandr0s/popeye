import Foundation

public struct ConnectionsService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadConnections() async throws -> [ConnectionDTO] {
        try await client.listConnections()
    }
}
