import Foundation

public struct ConnectionsService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadConnections() async throws -> [ConnectionDTO] {
        try await client.listConnections()
    }

    public func loadOAuthProviders() async throws -> [OAuthProviderAvailabilityDTO] {
        try await client.listOAuthProviders()
    }

    public func startOAuthConnection(
        providerKind: String,
        connectionId: String? = nil,
        mode: String = "read_only",
        syncIntervalSeconds: Int = 900
    ) async throws -> OAuthSessionDTO {
        try await client.startOAuthConnection(input: OAuthConnectStartInput(
            providerKind: providerKind,
            connectionId: connectionId,
            mode: mode,
            syncIntervalSeconds: syncIntervalSeconds
        ))
    }

    public func loadOAuthSession(id: String) async throws -> OAuthSessionDTO {
        try await client.getOAuthConnectionSession(id: id)
    }
}
