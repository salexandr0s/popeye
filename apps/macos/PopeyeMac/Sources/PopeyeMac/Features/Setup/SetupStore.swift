import AppKit
import Foundation
import PopeyeAPI

@Observable @MainActor
final class SetupStore {
    var workspaceID = "default"
    var connections: [ConnectionDTO] = []
    var oauthProviders: [OAuthProviderAvailabilityDTO] = []
    var providerAuthConfigs: [ProviderAuthConfigDTO] = []
    var relayCheckpoint: TelegramRelayCheckpointDTO?
    var uncertainDeliveries: [TelegramDeliveryDTO] = []
    var telegramConfig: TelegramConfigSnapshotDTO?
    var telegramMutationReceipts: [MutationReceiptDTO] = []
    var telegramSetupDraft = TelegramSetupDraft()
    var providerAuthDraft = OAuthProviderConfigDraft()
    var isPresentingTelegramSetup = false
    var isPresentingProviderAuthConfig = false
    var presentedProviderAuthProvider: OAuthProviderConfigKind?
    var selectedCardID: SetupCardID? = .daemon
    var isLoading = false
    var error: APIError?
    var activity: SetupActivity?
    var actionErrorMessage: String?
    var actionErrorCardID: SetupCardID?
    var providerAuthSheetErrorMessage: String?

    let connectionsService: any SetupConnectionsServing
    let providerAuthService: any SetupProviderAuthServing
    let telegramService: any SetupTelegramServing
    let secretsService: any SetupSecretsServing
    let governanceService: any SetupGovernanceServing
    let openURL: (URL) -> Bool
    let sleep: (Duration) async -> Void
    let emitInvalidation: (InvalidationSignal) -> Void
    let oauthPollInterval: Duration
    let oauthTimeout: Duration

    init(client: ControlAPIClient) {
        self.connectionsService = ConnectionsService(client: client)
        self.providerAuthService = ProviderAuthService(client: client)
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
        providerAuthService: any SetupProviderAuthServing,
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
        self.providerAuthService = providerAuthService
        self.telegramService = telegramService
        self.secretsService = secretsService
        self.governanceService = governanceService
        self.openURL = openURL
        self.sleep = sleep
        self.emitInvalidation = emitInvalidation
        self.oauthPollInterval = oauthPollInterval
        self.oauthTimeout = oauthTimeout
    }

    func beginPrimaryAction(_ action: SetupCardAction, for cardID: SetupCardID) {
        clearActionError()

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

        case .configureOAuth(let provider):
            presentProviderAuthSheet(for: provider)

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
}
