import Foundation
import Testing
@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("Setup Store")
struct SetupStoreTests {
    @Test("OAuth action opens the browser, polls to completion, and invalidates connections")
    func oauthSetupFlow() async throws {
        let pollCounter = PollCounter()
        let connection = Self.makeConnection(id: "conn-gmail-001", providerKind: "gmail", domain: "email", remediation: nil)
        let connectionsService = StubConnectionsService(
            loadConnectionsHandler: {
                [connection]
            },
            startOAuthConnectionHandler: { providerKind, connectionId, mode, syncIntervalSeconds in
                #expect(providerKind == "gmail")
                #expect(connectionId == nil)
                #expect(mode == "read_only")
                #expect(syncIntervalSeconds == 900)
                return OAuthSessionDTO(
                    id: "oauth-session-001",
                    providerKind: "gmail",
                    domain: "email",
                    status: "pending",
                    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test",
                    redirectUri: "http://127.0.0.1:3210/v1/connections/oauth/callback",
                    connectionId: nil,
                    accountId: nil,
                    error: nil,
                    createdAt: "2026-03-31T08:00:00Z",
                    expiresAt: "2026-03-31T08:10:00Z",
                    completedAt: nil
                )
            },
            loadOAuthSessionHandler: { _ in
                let pollCount = await pollCounter.next()
                return OAuthSessionDTO(
                    id: "oauth-session-001",
                    providerKind: "gmail",
                    domain: "email",
                    status: pollCount > 1 ? "completed" : "pending",
                    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test",
                    redirectUri: "http://127.0.0.1:3210/v1/connections/oauth/callback",
                    connectionId: nil,
                    accountId: "acct-1",
                    error: nil,
                    createdAt: "2026-03-31T08:00:00Z",
                    expiresAt: "2026-03-31T08:10:00Z",
                    completedAt: pollCount > 1 ? "2026-03-31T08:01:00Z" : nil
                )
            }
        )

        var openedURLs: [URL] = []
        var invalidations: [InvalidationSignal] = []

        let store = SetupStore(
            connectionsService: connectionsService,
            telegramService: StubTelegramService(),
            secretsService: StubSecretsService(),
            governanceService: StubGovernanceService(),
            openURL: { url in
                openedURLs.append(url)
                return true
            },
            sleep: { _ in },
            emitInvalidation: { invalidations.append($0) }
        )

        store.beginPrimaryAction(.oauth(kind: .startSetup, providerKind: "gmail", connectionId: nil), for: .gmail)
        await waitUntil { openedURLs.isEmpty == false && store.activity == nil }

        #expect(openedURLs.first?.absoluteString.contains("accounts.google.com") == true)
        #expect(store.errorMessage(for: .gmail) == nil)
        #expect(invalidations.count == 1)
        #expect({
            guard let first = invalidations.first else { return false }
            if case .connections = first { return true }
            return false
        }())
        #expect(store.connections.count == 1)
    }

    @Test("Telegram setup stores a token, saves config, refreshes receipts, and clears sensitive state")
    func telegramConfigFlow() async throws {
        let initialSnapshot = Self.makeTelegramSnapshot(
            persistedEnabled: false,
            appliedEnabled: false,
            allowedUserId: nil,
            secretRefId: nil,
            secretAvailability: "not_configured",
            staleComparedToApplied: false,
            managementMode: "manual",
            restartSupported: false
        )
        let savedSnapshot = Self.makeTelegramSnapshot(
            persistedEnabled: true,
            appliedEnabled: false,
            allowedUserId: "5315323298",
            secretRefId: "secret-telegram-bot",
            secretAvailability: "available",
            staleComparedToApplied: true,
            managementMode: "manual",
            restartSupported: false,
            warnings: ["Saved Telegram settings differ from the daemon-applied settings. Apply or restart the daemon to use the latest config."]
        )
        let snapshotBox = TelegramSnapshotBox(initial: initialSnapshot)
        let receipt = Self.makeMutationReceipt(
            id: "mut-telegram-001",
            kind: "telegram_config_update",
            component: "telegram",
            status: "succeeded",
            summary: "Saved Telegram config: enabled, allowedUserId, secretRefId"
        )
        let secret = SecretRefDTO(
            id: "secret-telegram-bot",
            provider: "keychain",
            key: "telegram-bot-token",
            createdAt: "2026-03-31T09:00:00Z",
            rotatedAt: nil,
            expiresAt: nil,
            connectionId: nil,
            description: "Telegram bot token"
        )

        var invalidations: [InvalidationSignal] = []

        let store = SetupStore(
            connectionsService: StubConnectionsService(),
            telegramService: StubTelegramService(
                loadConfigSnapshotHandler: {
                    await snapshotBox.get()
                },
                saveConfigHandler: { input in
                    #expect(input.enabled == true)
                    #expect(input.allowedUserId == "5315323298")
                    #expect(input.secretRefId == "secret-telegram-bot")
                    await snapshotBox.set(savedSnapshot)
                    return savedSnapshot
                }
            ),
            secretsService: StubSecretsService(storeSecretHandler: { input in
                #expect(input.key == "telegram-bot-token")
                #expect(input.value == "bot-token")
                return secret
            }),
            governanceService: StubGovernanceService(loadMutationReceiptsHandler: { component, limit in
                #expect(component == nil)
                #expect(limit == 6)
                return [receipt]
            }),
            emitInvalidation: { invalidations.append($0) }
        )

        store.telegramConfig = initialSnapshot
        store.telegramSetupDraft.enabled = true
        store.telegramSetupDraft.allowedUserId = "5315323298"
        store.telegramSetupDraft.botToken = "bot-token"
        store.isPresentingTelegramSetup = true

        await store.submitTelegramSetup()

        #expect(store.telegramConfig == savedSnapshot)
        #expect(store.telegramMutationReceipts.first?.id == "mut-telegram-001")
        #expect(store.telegramSetupDraft.botToken.isEmpty)
        #expect(store.telegramSetupDraft.currentSecretRefId == "secret-telegram-bot")
        #expect(store.telegramSetupDraft.allowedUserId == "5315323298")
        #expect(store.isPresentingTelegramSetup == false)
        #expect(store.errorMessage(for: .telegram) == nil)
        #expect({
            guard let first = invalidations.first else { return false }
            if case .telegram = first { return true }
            return false
        }())
    }

    @Test("OAuth timeout surfaces the waiting-for-browser error without invalidating connections")
    func oauthTimeoutFlow() async {
        var invalidations: [InvalidationSignal] = []

        let store = SetupStore(
            connectionsService: StubConnectionsService(
                startOAuthConnectionHandler: { providerKind, connectionId, mode, syncIntervalSeconds in
                    #expect(providerKind == "gmail")
                    #expect(connectionId == nil)
                    #expect(mode == "read_only")
                    #expect(syncIntervalSeconds == 900)
                    return OAuthSessionDTO(
                        id: "oauth-session-timeout",
                        providerKind: "gmail",
                        domain: "email",
                        status: "pending",
                        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test",
                        redirectUri: "http://127.0.0.1:3210/v1/connections/oauth/callback",
                        connectionId: nil,
                        accountId: nil,
                        error: nil,
                        createdAt: "2026-03-31T08:00:00Z",
                        expiresAt: "2026-03-31T08:10:00Z",
                        completedAt: nil
                    )
                }
            ),
            telegramService: StubTelegramService(),
            secretsService: StubSecretsService(),
            governanceService: StubGovernanceService(),
            openURL: { _ in true },
            sleep: { _ in },
            emitInvalidation: { invalidations.append($0) },
            oauthTimeout: .zero
        )

        store.beginPrimaryAction(.oauth(kind: .startSetup, providerKind: "gmail", connectionId: nil), for: .gmail)
        await waitUntil { store.activity == nil && store.errorMessage(for: .gmail) != nil }

        #expect(store.errorMessage(for: .gmail) == "Still waiting for browser completion. Finish the provider auth in your browser, then try Refresh if needed.")
        #expect(invalidations.isEmpty)
    }

    private func waitUntil(
        _ predicate: @escaping @MainActor () -> Bool,
        attempts: Int = 20
    ) async {
        for _ in 0..<attempts {
            if predicate() { return }
            await Task.yield()
        }
    }

    private static func makeConnection(
        id: String,
        providerKind: String,
        domain: String,
        remediation: ConnectionRemediationDTO?
    ) -> ConnectionDTO {
        ConnectionDTO(
            id: id,
            domain: domain,
            providerKind: providerKind,
            label: providerKind.capitalized,
            mode: "read_only",
            enabled: true,
            lastSyncAt: nil,
            lastSyncStatus: nil,
            policy: ConnectionPolicyDTO(status: "ready", secretStatus: "configured", mutatingRequiresApproval: false),
            health: ConnectionHealthDTO(status: "healthy", authState: "configured", checkedAt: nil, lastError: nil, remediation: remediation),
            sync: ConnectionSyncDTO(lastAttemptAt: nil, lastSuccessAt: nil, status: "success", lagSummary: ""),
            createdAt: "2026-03-31T09:00:00Z",
            updatedAt: "2026-03-31T09:00:00Z"
        )
    }

    private static func makeTelegramSnapshot(
        persistedEnabled: Bool,
        appliedEnabled: Bool,
        allowedUserId: String?,
        secretRefId: String?,
        secretAvailability: String,
        staleComparedToApplied: Bool,
        managementMode: String,
        restartSupported: Bool,
        warnings: [String] = []
    ) -> TelegramConfigSnapshotDTO {
        TelegramConfigSnapshotDTO(
            persisted: TelegramConfigRecordDTO(
                enabled: persistedEnabled,
                allowedUserId: allowedUserId,
                secretRefId: secretRefId
            ),
            applied: TelegramConfigRecordDTO(
                enabled: appliedEnabled,
                allowedUserId: appliedEnabled ? allowedUserId : nil,
                secretRefId: appliedEnabled ? secretRefId : nil
            ),
            effectiveWorkspaceId: "default",
            secretAvailability: secretAvailability,
            staleComparedToApplied: staleComparedToApplied,
            warnings: warnings,
            managementMode: managementMode,
            restartSupported: restartSupported
        )
    }

    private static func makeMutationReceipt(
        id: String,
        kind: String,
        component: String,
        status: String,
        summary: String
    ) -> MutationReceiptDTO {
        MutationReceiptDTO(
            id: id,
            kind: kind,
            component: component,
            status: status,
            summary: summary,
            details: "details",
            actorRole: "operator",
            workspaceId: nil,
            usage: ReceiptUsageDTO(provider: "control-plane", model: "mutation", tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0),
            metadata: [:],
            createdAt: "2026-03-31T09:05:00Z"
        )
    }
}

private struct StubConnectionsService: SetupConnectionsServing {
    var loadConnectionsHandler: @Sendable () async throws -> [ConnectionDTO] = { [] }
    var startOAuthConnectionHandler: @Sendable (_ providerKind: String, _ connectionId: String?, _ mode: String, _ syncIntervalSeconds: Int) async throws -> OAuthSessionDTO = { _, _, _, _ in
        throw APIError.notFound
    }
    var loadOAuthSessionHandler: @Sendable (_ id: String) async throws -> OAuthSessionDTO = { _ in
        throw APIError.notFound
    }

    init(
        loadConnectionsHandler: @escaping @Sendable () async throws -> [ConnectionDTO] = { [] },
        startOAuthConnectionHandler: @escaping @Sendable (_ providerKind: String, _ connectionId: String?, _ mode: String, _ syncIntervalSeconds: Int) async throws -> OAuthSessionDTO = { _, _, _, _ in throw APIError.notFound },
        loadOAuthSessionHandler: @escaping @Sendable (_ id: String) async throws -> OAuthSessionDTO = { _ in throw APIError.notFound }
    ) {
        self.loadConnectionsHandler = loadConnectionsHandler
        self.startOAuthConnectionHandler = startOAuthConnectionHandler
        self.loadOAuthSessionHandler = loadOAuthSessionHandler
    }

    func loadConnections() async throws -> [ConnectionDTO] {
        try await loadConnectionsHandler()
    }

    func startOAuthConnection(providerKind: String, connectionId: String?, mode: String, syncIntervalSeconds: Int) async throws -> OAuthSessionDTO {
        try await startOAuthConnectionHandler(providerKind, connectionId, mode, syncIntervalSeconds)
    }

    func loadOAuthSession(id: String) async throws -> OAuthSessionDTO {
        try await loadOAuthSessionHandler(id)
    }
}

private struct StubTelegramService: SetupTelegramServing {
    var loadUncertainDeliveriesHandler: @Sendable (String) async throws -> [TelegramDeliveryDTO] = { _ in [] }
    var loadRelayCheckpointHandler: @Sendable (String) async throws -> TelegramRelayCheckpointDTO? = { _ in nil }
    var loadConfigSnapshotHandler: @Sendable () async throws -> TelegramConfigSnapshotDTO = {
        TelegramConfigSnapshotDTO(
            persisted: TelegramConfigRecordDTO(enabled: false, allowedUserId: nil, secretRefId: nil),
            applied: TelegramConfigRecordDTO(enabled: false, allowedUserId: nil, secretRefId: nil),
            effectiveWorkspaceId: "default",
            secretAvailability: "not_configured",
            staleComparedToApplied: false,
            warnings: [],
            managementMode: "manual",
            restartSupported: false
        )
    }
    var saveConfigHandler: @Sendable (TelegramConfigUpdateInput) async throws -> TelegramConfigSnapshotDTO = { input in
        TelegramConfigSnapshotDTO(
            persisted: TelegramConfigRecordDTO(enabled: input.enabled, allowedUserId: input.allowedUserId, secretRefId: input.secretRefId),
            applied: TelegramConfigRecordDTO(enabled: false, allowedUserId: nil, secretRefId: nil),
            effectiveWorkspaceId: "default",
            secretAvailability: input.secretRefId == nil ? "not_configured" : "available",
            staleComparedToApplied: true,
            warnings: [],
            managementMode: "manual",
            restartSupported: false
        )
    }
    var applyConfigHandler: @Sendable () async throws -> TelegramApplyResponseDTO = {
        let snapshot = TelegramConfigSnapshotDTO(
            persisted: TelegramConfigRecordDTO(enabled: true, allowedUserId: "42", secretRefId: "secret-1"),
            applied: TelegramConfigRecordDTO(enabled: true, allowedUserId: "42", secretRefId: "secret-1"),
            effectiveWorkspaceId: "default",
            secretAvailability: "available",
            staleComparedToApplied: false,
            warnings: [],
            managementMode: "manual",
            restartSupported: false
        )
        return TelegramApplyResponseDTO(status: "reloaded_active", summary: "Telegram bridge reloaded and is active.", snapshot: snapshot)
    }
    var restartDaemonHandler: @Sendable () async throws -> DaemonRestartResponseDTO = {
        DaemonRestartResponseDTO(status: "manual_required", summary: "Restart required.", managementMode: "manual", restartSupported: false)
    }

    init(
        loadUncertainDeliveriesHandler: @escaping @Sendable (String) async throws -> [TelegramDeliveryDTO] = { _ in [] },
        loadRelayCheckpointHandler: @escaping @Sendable (String) async throws -> TelegramRelayCheckpointDTO? = { _ in nil },
        loadConfigSnapshotHandler: @escaping @Sendable () async throws -> TelegramConfigSnapshotDTO = {
            TelegramConfigSnapshotDTO(
                persisted: TelegramConfigRecordDTO(enabled: false, allowedUserId: nil, secretRefId: nil),
                applied: TelegramConfigRecordDTO(enabled: false, allowedUserId: nil, secretRefId: nil),
                effectiveWorkspaceId: "default",
                secretAvailability: "not_configured",
                staleComparedToApplied: false,
                warnings: [],
                managementMode: "manual",
                restartSupported: false
            )
        },
        saveConfigHandler: @escaping @Sendable (TelegramConfigUpdateInput) async throws -> TelegramConfigSnapshotDTO = { input in
            TelegramConfigSnapshotDTO(
                persisted: TelegramConfigRecordDTO(enabled: input.enabled, allowedUserId: input.allowedUserId, secretRefId: input.secretRefId),
                applied: TelegramConfigRecordDTO(enabled: false, allowedUserId: nil, secretRefId: nil),
                effectiveWorkspaceId: "default",
                secretAvailability: input.secretRefId == nil ? "not_configured" : "available",
                staleComparedToApplied: true,
                warnings: [],
                managementMode: "manual",
                restartSupported: false
            )
        },
        applyConfigHandler: @escaping @Sendable () async throws -> TelegramApplyResponseDTO = {
            let snapshot = TelegramConfigSnapshotDTO(
                persisted: TelegramConfigRecordDTO(enabled: true, allowedUserId: "42", secretRefId: "secret-1"),
                applied: TelegramConfigRecordDTO(enabled: true, allowedUserId: "42", secretRefId: "secret-1"),
                effectiveWorkspaceId: "default",
                secretAvailability: "available",
                staleComparedToApplied: false,
                warnings: [],
                managementMode: "manual",
                restartSupported: false
            )
            return TelegramApplyResponseDTO(status: "reloaded_active", summary: "Telegram bridge reloaded and is active.", snapshot: snapshot)
        },
        restartDaemonHandler: @escaping @Sendable () async throws -> DaemonRestartResponseDTO = {
            DaemonRestartResponseDTO(status: "manual_required", summary: "Restart required.", managementMode: "manual", restartSupported: false)
        }
    ) {
        self.loadUncertainDeliveriesHandler = loadUncertainDeliveriesHandler
        self.loadRelayCheckpointHandler = loadRelayCheckpointHandler
        self.loadConfigSnapshotHandler = loadConfigSnapshotHandler
        self.saveConfigHandler = saveConfigHandler
        self.applyConfigHandler = applyConfigHandler
        self.restartDaemonHandler = restartDaemonHandler
    }

    func loadUncertainDeliveries(workspaceId: String) async throws -> [TelegramDeliveryDTO] {
        try await loadUncertainDeliveriesHandler(workspaceId)
    }

    func loadRelayCheckpoint(workspaceId: String) async throws -> TelegramRelayCheckpointDTO? {
        try await loadRelayCheckpointHandler(workspaceId)
    }

    func loadConfigSnapshot() async throws -> TelegramConfigSnapshotDTO {
        try await loadConfigSnapshotHandler()
    }

    func saveConfig(_ input: TelegramConfigUpdateInput) async throws -> TelegramConfigSnapshotDTO {
        try await saveConfigHandler(input)
    }

    func applyConfig() async throws -> TelegramApplyResponseDTO {
        try await applyConfigHandler()
    }

    func restartDaemon() async throws -> DaemonRestartResponseDTO {
        try await restartDaemonHandler()
    }
}

private struct StubSecretsService: SetupSecretsServing {
    var storeSecretHandler: @Sendable (StoreSecretInput) async throws -> SecretRefDTO = { _ in
        throw APIError.notFound
    }

    init(storeSecretHandler: @escaping @Sendable (StoreSecretInput) async throws -> SecretRefDTO = { _ in throw APIError.notFound }) {
        self.storeSecretHandler = storeSecretHandler
    }

    func storeSecret(_ input: StoreSecretInput) async throws -> SecretRefDTO {
        try await storeSecretHandler(input)
    }
}

private struct StubGovernanceService: SetupGovernanceServing {
    var loadMutationReceiptsHandler: @Sendable (_ component: String?, _ limit: Int) async throws -> [MutationReceiptDTO] = { _, _ in [] }

    init(loadMutationReceiptsHandler: @escaping @Sendable (_ component: String?, _ limit: Int) async throws -> [MutationReceiptDTO] = { _, _ in [] }) {
        self.loadMutationReceiptsHandler = loadMutationReceiptsHandler
    }

    func loadMutationReceipts(component: String?, limit: Int) async throws -> [MutationReceiptDTO] {
        try await loadMutationReceiptsHandler(component, limit)
    }
}

private actor PollCounter {
    private var count = 0

    func next() -> Int {
        count += 1
        return count
    }
}

private actor TelegramSnapshotBox {
    private var snapshot: TelegramConfigSnapshotDTO

    init(initial: TelegramConfigSnapshotDTO) {
        self.snapshot = initial
    }

    func get() -> TelegramConfigSnapshotDTO {
        snapshot
    }

    func set(_ snapshot: TelegramConfigSnapshotDTO) {
        self.snapshot = snapshot
    }
}
