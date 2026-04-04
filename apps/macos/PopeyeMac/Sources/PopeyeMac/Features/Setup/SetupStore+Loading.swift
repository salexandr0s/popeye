import Foundation
import PopeyeAPI

extension SetupStore {
    func load() async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            async let loadedConnections = connectionsService.loadConnections()
            async let loadedProviders = connectionsService.loadOAuthProviders()
            async let loadedProviderAuthConfigs = providerAuthService.loadConfig()
            connections = try await loadedConnections
            oauthProviders = try await loadedProviders
            providerAuthConfigs = try await loadedProviderAuthConfigs
            await loadTelegramDetailState()
            applySnapshotToDraft(force: false)
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
    }

    func loadTelegramDetailState() async {
        uncertainDeliveries = (try? await telegramService.loadUncertainDeliveries(workspaceId: workspaceID)) ?? []
        relayCheckpoint = try? await telegramService.loadRelayCheckpoint(workspaceId: workspaceID)
        telegramConfig = try? await telegramService.loadConfigSnapshot()
        telegramMutationReceipts = (try? await governanceService.loadMutationReceipts(component: nil, limit: 6)) ?? []
    }

    func refreshTelegramDetailState() async {
        await loadTelegramDetailState()
        applySnapshotToDraft(force: true)
    }
}
