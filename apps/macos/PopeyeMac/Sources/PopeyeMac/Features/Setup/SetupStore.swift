import AppKit
import Foundation
import PopeyeAPI

protocol SetupConnectionsServing: Sendable {
    func loadConnections() async throws -> [ConnectionDTO]
    func startOAuthConnection(
        providerKind: String,
        connectionId: String?,
        mode: String,
        syncIntervalSeconds: Int
    ) async throws -> OAuthSessionDTO
    func loadOAuthSession(id: String) async throws -> OAuthSessionDTO
}

extension ConnectionsService: SetupConnectionsServing {}

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

@Observable @MainActor
final class SetupStore {
    enum Activity: Equatable {
        case oauthStarting(cardID: SetupCardID, kind: SetupOAuthActionKind)
        case oauthWaiting(cardID: SetupCardID, kind: SetupOAuthActionKind)
        case savingTelegramSettings
        case applyingTelegramConfig
        case restartingDaemon

        var cardID: SetupCardID {
            switch self {
            case .oauthStarting(let cardID, _), .oauthWaiting(let cardID, _):
                cardID
            case .savingTelegramSettings, .applyingTelegramConfig, .restartingDaemon:
                .telegram
            }
        }

        var message: String {
            switch self {
            case .oauthStarting(_, let kind):
                kind.progressTitle
            case .oauthWaiting(_, let kind):
                kind.waitingTitle
            case .savingTelegramSettings:
                "Saving Telegram settings…"
            case .applyingTelegramConfig:
                "Applying Telegram bridge config…"
            case .restartingDaemon:
                "Scheduling daemon restart…"
            }
        }
    }

    enum SetupActionError: LocalizedError {
        case invalidAuthorizationURL
        case browserLaunchFailed
        case oauthFailed(String)
        case oauthExpired
        case oauthTimedOut

        var errorDescription: String? {
            switch self {
            case .invalidAuthorizationURL:
                "The daemon returned an invalid browser authorization URL."
            case .browserLaunchFailed:
                "The Mac app could not open the default browser for setup."
            case .oauthFailed(let message):
                message
            case .oauthExpired:
                "The browser setup session expired. Start the provider setup again."
            case .oauthTimedOut:
                "Still waiting for browser completion. Finish the provider auth in your browser, then try Refresh if needed."
            }
        }
    }

    var workspaceID = "default"
    var connections: [ConnectionDTO] = []
    var relayCheckpoint: TelegramRelayCheckpointDTO?
    var uncertainDeliveries: [TelegramDeliveryDTO] = []
    var telegramConfig: TelegramConfigSnapshotDTO?
    var telegramMutationReceipts: [MutationReceiptDTO] = []
    var telegramSetupDraft = TelegramSetupDraft()
    var isPresentingTelegramSetup = false
    var selectedCardID: SetupCardID? = .daemon
    var isLoading = false
    var error: APIError?
    var activity: Activity?
    var actionErrorMessage: String?
    var actionErrorCardID: SetupCardID?

    private let connectionsService: any SetupConnectionsServing
    private let telegramService: any SetupTelegramServing
    private let secretsService: any SetupSecretsServing
    private let governanceService: any SetupGovernanceServing
    private let openURL: (URL) -> Bool
    private let sleep: (Duration) async -> Void
    private let emitInvalidation: (InvalidationSignal) -> Void
    private let oauthPollInterval: Duration
    private let oauthTimeout: Duration

    init(client: ControlAPIClient) {
        self.connectionsService = ConnectionsService(client: client)
        self.telegramService = TelegramService(client: client)
        self.secretsService = SecretsService(client: client)
        self.governanceService = GovernanceService(client: client)
        self.openURL = { url in NSWorkspace.shared.open(url) }
        self.sleep = { duration in try? await Task.sleep(for: duration) }
        self.emitInvalidation = { signal in
            NotificationCenter.default.post(name: .popeyeInvalidation, object: signal)
        }
        self.oauthPollInterval = .seconds(2)
        self.oauthTimeout = .seconds(120)
    }

    init(
        connectionsService: any SetupConnectionsServing,
        telegramService: any SetupTelegramServing,
        secretsService: any SetupSecretsServing,
        governanceService: any SetupGovernanceServing,
        openURL: @escaping (URL) -> Bool = { _ in true },
        sleep: @escaping (Duration) async -> Void = { _ in },
        emitInvalidation: @escaping (InvalidationSignal) -> Void = { _ in },
        oauthPollInterval: Duration = .seconds(2),
        oauthTimeout: Duration = .seconds(120)
    ) {
        self.connectionsService = connectionsService
        self.telegramService = telegramService
        self.secretsService = secretsService
        self.governanceService = governanceService
        self.openURL = openURL
        self.sleep = sleep
        self.emitInvalidation = emitInvalidation
        self.oauthPollInterval = oauthPollInterval
        self.oauthTimeout = oauthTimeout
    }

    func load() async {
        isLoading = true
        error = nil

        do {
            connections = try await connectionsService.loadConnections()
            uncertainDeliveries = (try? await telegramService.loadUncertainDeliveries(workspaceId: workspaceID)) ?? []
            relayCheckpoint = try? await telegramService.loadRelayCheckpoint(workspaceId: workspaceID)
            telegramConfig = try? await telegramService.loadConfigSnapshot()
            telegramMutationReceipts = (try? await governanceService.loadMutationReceipts(component: nil, limit: 6)) ?? []
            applySnapshotToDraft(force: false)
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }

        isLoading = false
    }

    func beginPrimaryAction(_ action: SetupCardAction, for cardID: SetupCardID) {
        actionErrorMessage = nil
        actionErrorCardID = nil

        switch action {
        case .oauth(let kind, let providerKind, let connectionId):
            activity = .oauthStarting(cardID: cardID, kind: kind)
            Task {
                await executeOAuthAction(
                    kind: kind,
                    providerKind: providerKind,
                    connectionId: connectionId,
                    cardID: cardID
                )
            }

        case .telegramConfigure:
            presentTelegramSetup()

        case .telegramApply:
            activity = .applyingTelegramConfig
            Task { await applyTelegramConfig() }

        case .daemonRestart:
            activity = .restartingDaemon
            Task { await restartDaemon() }
        }
    }

    func dismissTelegramSetup() {
        telegramSetupDraft.clearSensitiveFields()
        isPresentingTelegramSetup = false
    }

    func submitTelegramSetup() async {
        if telegramSetupDraft.enabled && telegramSetupDraft.normalizedAllowedUserId == nil {
            actionErrorCardID = .telegram
            actionErrorMessage = "Allowed Telegram user ID is required when Telegram is enabled."
            telegramSetupDraft.clearSensitiveFields()
            return
        }

        actionErrorMessage = nil
        actionErrorCardID = nil
        activity = .savingTelegramSettings

        do {
            var secretRefID = telegramSetupDraft.currentSecretRefId

            if telegramSetupDraft.normalizedBotToken.isEmpty == false {
                let secret = try await secretsService.storeSecret(StoreSecretInput(
                    key: "telegram-bot-token",
                    value: telegramSetupDraft.normalizedBotToken,
                    description: "Telegram bot token"
                ))
                secretRefID = secret.id
            }

            telegramConfig = try await telegramService.saveConfig(TelegramConfigUpdateInput(
                enabled: telegramSetupDraft.enabled,
                allowedUserId: telegramSetupDraft.normalizedAllowedUserId,
                secretRefId: secretRefID
            ))
            telegramSetupDraft.clearSensitiveFields()
            applySnapshotToDraft(force: true)
            isPresentingTelegramSetup = false
            await refreshTelegramDetailState()
            emitInvalidation(.telegram)
        } catch let apiError as APIError {
            actionErrorCardID = .telegram
            actionErrorMessage = apiError.userMessage
            telegramSetupDraft.clearSensitiveFields()
        } catch {
            actionErrorCardID = .telegram
            actionErrorMessage = "Telegram configuration failed."
            telegramSetupDraft.clearSensitiveFields()
        }

        activity = nil
    }

    func statusMessage(for cardID: SetupCardID) -> String? {
        guard activity?.cardID == cardID else { return nil }
        return activity?.message
    }

    func errorMessage(for cardID: SetupCardID) -> String? {
        guard actionErrorCardID == cardID else { return nil }
        return actionErrorMessage
    }

    func isPerformingAction(for cardID: SetupCardID) -> Bool {
        activity?.cardID == cardID
    }

    private func executeOAuthAction(
        kind: SetupOAuthActionKind,
        providerKind: String,
        connectionId: String?,
        cardID: SetupCardID
    ) async {
        actionErrorMessage = nil
        actionErrorCardID = nil
        activity = .oauthStarting(cardID: cardID, kind: kind)

        do {
            let session = try await connectionsService.startOAuthConnection(
                providerKind: providerKind,
                connectionId: connectionId,
                mode: "read_only",
                syncIntervalSeconds: 900
            )

            guard let url = URL(string: session.authorizationUrl) else {
                throw SetupActionError.invalidAuthorizationURL
            }

            guard openURL(url) else {
                throw SetupActionError.browserLaunchFailed
            }

            activity = .oauthWaiting(cardID: cardID, kind: kind)
            try await waitForOAuthCompletion(sessionID: session.id)
            await load()
            emitInvalidation(.connections)
        } catch let apiError as APIError {
            actionErrorCardID = cardID
            actionErrorMessage = apiError.userMessage
        } catch let actionError as SetupActionError {
            actionErrorCardID = cardID
            actionErrorMessage = actionError.errorDescription
        } catch {
            actionErrorCardID = cardID
            actionErrorMessage = "Provider setup failed."
        }

        activity = nil
    }

    private func applyTelegramConfig() async {
        actionErrorMessage = nil
        actionErrorCardID = nil

        do {
            let response = try await telegramService.applyConfig()
            telegramConfig = response.snapshot
            if response.status.hasPrefix("failed") {
                actionErrorCardID = .telegram
                actionErrorMessage = response.summary
            }
            await refreshTelegramDetailState()
            emitInvalidation(.telegram)
        } catch let apiError as APIError {
            actionErrorCardID = .telegram
            actionErrorMessage = apiError.userMessage
        } catch {
            actionErrorCardID = .telegram
            actionErrorMessage = "Telegram apply failed."
        }

        activity = nil
    }

    private func restartDaemon() async {
        actionErrorMessage = nil
        actionErrorCardID = nil

        do {
            let response = try await telegramService.restartDaemon()
            if response.status == "manual_required" {
                actionErrorCardID = .telegram
                actionErrorMessage = response.summary
            }
            await refreshTelegramDetailState()
        } catch let apiError as APIError {
            actionErrorCardID = .telegram
            actionErrorMessage = apiError.userMessage
        } catch {
            actionErrorCardID = .telegram
            actionErrorMessage = "Daemon restart request failed."
        }

        activity = nil
    }

    private func waitForOAuthCompletion(sessionID: String) async throws {
        let deadline = ContinuousClock.now + oauthTimeout

        while ContinuousClock.now < deadline {
            let session = try await connectionsService.loadOAuthSession(id: sessionID)

            switch session.status {
            case "completed":
                return
            case "failed":
                throw SetupActionError.oauthFailed(session.error ?? "The provider authorization failed.")
            case "expired":
                throw SetupActionError.oauthExpired
            default:
                await sleep(oauthPollInterval)
            }
        }

        throw SetupActionError.oauthTimedOut
    }

    private func presentTelegramSetup() {
        applySnapshotToDraft(force: true)
        actionErrorMessage = nil
        actionErrorCardID = nil
        isPresentingTelegramSetup = true
    }

    private func applySnapshotToDraft(force: Bool) {
        guard force || isPresentingTelegramSetup == false else { return }
        telegramSetupDraft.enabled = telegramConfig?.persisted.enabled ?? false
        telegramSetupDraft.allowedUserId = telegramConfig?.persisted.allowedUserId ?? ""
        telegramSetupDraft.currentSecretRefId = telegramConfig?.persisted.secretRefId
    }

    private func refreshTelegramDetailState() async {
        uncertainDeliveries = (try? await telegramService.loadUncertainDeliveries(workspaceId: workspaceID)) ?? []
        relayCheckpoint = try? await telegramService.loadRelayCheckpoint(workspaceId: workspaceID)
        telegramConfig = try? await telegramService.loadConfigSnapshot()
        telegramMutationReceipts = (try? await governanceService.loadMutationReceipts(component: nil, limit: 6)) ?? []
        applySnapshotToDraft(force: true)
    }
}
