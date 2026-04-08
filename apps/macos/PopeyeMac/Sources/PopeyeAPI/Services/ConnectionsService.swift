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

    public func updateConnection(id: String, input: ConnectionUpdateInput) async throws -> ConnectionDTO {
        try await client.updateConnection(id: id, input: input)
    }

    public func loadResourceRules(connectionId: String) async throws -> [ConnectionResourceRuleDTO] {
        try await client.listConnectionResourceRules(connectionId: connectionId)
    }

    public func addResourceRule(
        connectionId: String,
        input: ConnectionResourceRuleCreateInput
    ) async throws -> ConnectionDTO {
        try await client.addConnectionResourceRule(connectionId: connectionId, input: input)
    }

    public func removeResourceRule(
        connectionId: String,
        input: ConnectionResourceRuleDeleteInput
    ) async throws -> ConnectionDTO {
        try await client.removeConnectionResourceRule(connectionId: connectionId, input: input)
    }

    public func loadDiagnostics(connectionId: String) async throws -> ConnectionDiagnosticsDTO {
        try await client.getConnectionDiagnostics(connectionId: connectionId)
    }

    public func reconnect(
        connectionId: String,
        action: String
    ) async throws -> ConnectionDTO {
        try await client.reconnectConnection(
            connectionId: connectionId,
            input: ConnectionReconnectInput(action: action)
        )
    }
}
