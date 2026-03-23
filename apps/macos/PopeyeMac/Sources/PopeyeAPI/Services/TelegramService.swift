import Foundation

public struct TelegramService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadUncertainDeliveries(workspaceId: String = "default") async throws -> [TelegramDeliveryDTO] {
        try await client.listUncertainDeliveries(workspaceId: workspaceId)
    }

    public func loadRelayCheckpoint(workspaceId: String = "default") async throws -> TelegramRelayCheckpointDTO? {
        try await client.telegramRelayCheckpoint(workspaceId: workspaceId)
    }

    public func loadDeliveryDetail(id: String) async throws -> TelegramDeliveryDetailSnapshot {
        async let delivery = client.getTelegramDelivery(id: id)
        async let resolutions = client.listDeliveryResolutions(id: id)
        async let attempts = client.listDeliverySendAttempts(id: id)

        return TelegramDeliveryDetailSnapshot(
            delivery: try await delivery,
            resolutions: try await resolutions,
            attempts: try await attempts
        )
    }

    public func resolveDelivery(id: String, input: TelegramDeliveryResolveInput) async throws -> TelegramResolutionDTO {
        try await client.resolveTelegramDelivery(id: id, input: input)
    }
}
