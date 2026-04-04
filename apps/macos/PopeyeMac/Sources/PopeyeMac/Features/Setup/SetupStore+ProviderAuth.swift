import Foundation
import PopeyeAPI

extension SetupStore {
    func loadProviderAuthConfigs() async {
        providerAuthConfigs = (try? await providerAuthService.loadConfig()) ?? []
    }

    func presentProviderAuthSheet(for provider: OAuthProviderConfigKind) {
        presentedProviderAuthProvider = provider
        providerAuthSheetErrorMessage = nil
        providerAuthDraft.apply(record: providerAuthRecord(for: provider))
        isPresentingProviderAuthConfig = true
    }

    func dismissProviderAuthSheet() {
        isPresentingProviderAuthConfig = false
        presentedProviderAuthProvider = nil
        providerAuthSheetErrorMessage = nil
        providerAuthDraft.clearSensitiveFields()
    }

    func providerAuthRecord(for provider: OAuthProviderConfigKind) -> ProviderAuthConfigDTO? {
        providerAuthConfigs.first { $0.provider == provider.rawValue }
    }

    func submitProviderAuthConfig() async {
        guard let provider = presentedProviderAuthProvider else { return }
        let cardID = cardID(for: provider)
        activity = .savingProviderAuth(cardID: cardID)
        providerAuthSheetErrorMessage = nil
        clearActionError()

        defer { activity = nil }

        do {
            providerAuthConfigs = try await providerAuthService.saveConfig(
                provider: provider.rawValue,
                input: ProviderAuthConfigUpdateInput(
                    clientId: providerAuthDraft.normalizedClientId,
                    clientSecret: providerAuthDraft.normalizedClientSecret,
                    clearStoredSecret: providerAuthDraft.clearStoredSecret
                )
            )
            async let refreshedConnections = connectionsService.loadConnections()
            async let refreshedProviders = connectionsService.loadOAuthProviders()
            connections = try await refreshedConnections
            oauthProviders = try await refreshedProviders
            providerAuthDraft.clearSensitiveFields()
            isPresentingProviderAuthConfig = false
            presentedProviderAuthProvider = nil
            emitInvalidation(.connections)
        } catch let error as APIError {
            providerAuthSheetErrorMessage = error.userMessage
            setActionError(error.userMessage, for: cardID)
        } catch {
            providerAuthSheetErrorMessage = error.localizedDescription
            setActionError(error.localizedDescription, for: cardID)
        }
    }

    private func cardID(for provider: OAuthProviderConfigKind) -> SetupCardID {
        switch provider {
        case .google:
            if selectedCardID == .googleCalendar {
                return .googleCalendar
            }
            return .gmail
        case .github:
            return .github
        }
    }
}
