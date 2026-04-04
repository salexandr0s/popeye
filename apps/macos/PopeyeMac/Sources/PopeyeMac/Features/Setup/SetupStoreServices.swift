import PopeyeAPI

protocol SetupConnectionsServing: Sendable {
    func loadConnections() async throws -> [ConnectionDTO]
    func loadOAuthProviders() async throws -> [OAuthProviderAvailabilityDTO]
    func startOAuthConnection(
        providerKind: String,
        connectionId: String?,
        mode: String,
        syncIntervalSeconds: Int
    ) async throws -> OAuthSessionDTO
    func loadOAuthSession(id: String) async throws -> OAuthSessionDTO
}

extension ConnectionsService: SetupConnectionsServing {}

protocol SetupProviderAuthServing: Sendable {
    func loadConfig() async throws -> [ProviderAuthConfigDTO]
    func saveConfig(provider: String, input: ProviderAuthConfigUpdateInput) async throws -> [ProviderAuthConfigDTO]
}

extension ProviderAuthService: SetupProviderAuthServing {}

protocol SetupTelegramServing: Sendable {
    func loadUncertainDeliveries(workspaceId: String) async throws -> [TelegramDeliveryDTO]
    func loadRelayCheckpoint(workspaceId: String) async throws -> TelegramRelayCheckpointDTO?
    func loadConfigSnapshot() async throws -> TelegramConfigSnapshotDTO
    func saveConfig(_ input: TelegramConfigUpdateInput) async throws -> TelegramConfigSnapshotDTO
    func applyConfig() async throws -> TelegramApplyResponseDTO
    func restartDaemon() async throws -> DaemonRestartResponseDTO
}

extension TelegramService: SetupTelegramServing {}

protocol SetupSecretsServing: Sendable {
    func storeSecret(_ input: StoreSecretInput) async throws -> SecretRefDTO
}

extension SecretsService: SetupSecretsServing {}

protocol SetupGovernanceServing: Sendable {
    func loadMutationReceipts(component: String?, limit: Int) async throws -> [MutationReceiptDTO]
}

extension GovernanceService: SetupGovernanceServing {}
