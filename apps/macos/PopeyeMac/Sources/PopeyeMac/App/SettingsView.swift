import SwiftUI
import PopeyeAPI

struct SettingsView: View {
    @Environment(AppModel.self) private var appModel
    @State private var diagnosticsResult: DiagnosticsResult?
    @State private var isTesting = false
    @State private var providerAuthConfigs: [ProviderAuthConfigDTO] = []
    @State private var presentedProviderAuthProvider: OAuthProviderConfigKind?
    @State private var providerAuthDraft = OAuthProviderConfigDraft()
    @State private var providerAuthSaveErrorMessage: String?
    @State private var isSavingProviderAuth = false

    init(
        diagnosticsResult: DiagnosticsResult? = nil,
        isTesting: Bool = false
    ) {
        _diagnosticsResult = State(initialValue: diagnosticsResult)
        _isTesting = State(initialValue: isTesting)
    }

    var body: some View {
        @Bindable var model = appModel

        Form {
            SettingsConnectionSection(
                baseURL: appModel.baseURL,
                connectionState: appModel.connectionState,
                isConnected: appModel.isConnected,
                sseConnected: appModel.sseConnected,
                disconnect: disconnect
            )
            SettingsDiagnosticsSection(
                result: diagnosticsResult,
                isTesting: isTesting,
                isConnected: appModel.isConnected,
                testConnection: { Task { await testConnection() } }
            )
            SettingsRefreshSection(
                sseEnabled: $model.sseEnabled,
                pollIntervalSeconds: $model.pollIntervalSeconds
            )
            SettingsProviderAuthSection(
                records: providerAuthConfigs,
                configureProvider: presentProviderAuthEditor
            )
            SettingsAboutSection(
                shortVersion: Bundle.main.shortVersion,
                buildNumber: Bundle.main.buildNumber
            )
        }
        .formStyle(.grouped)
        .frame(minWidth: 450, idealWidth: 480, minHeight: 480)
        .task {
            await loadProviderAuthConfigs()
        }
        .onChange(of: appModel.isConnected) { _, _ in
            Task { await loadProviderAuthConfigs() }
        }
        .sheet(item: $presentedProviderAuthProvider) { provider in
            OAuthProviderConfigSheet(
                provider: provider,
                currentRecord: providerAuthConfigs.first(where: { $0.provider == provider.rawValue }),
                draft: $providerAuthDraft,
                isSaving: isSavingProviderAuth,
                errorMessage: providerAuthSaveErrorMessage,
                onCancel: dismissProviderAuthEditor,
                onSubmit: {
                    Task { await saveProviderAuthConfig() }
                }
            )
        }
    }

    private func disconnect() {
        appModel.disconnect()
        diagnosticsResult = nil
    }

    private func testConnection() async {
        guard let client = appModel.client else { return }

        isTesting = true
        let start = ContinuousClock.now

        do {
            _ = try await client.health()
            diagnosticsResult = DiagnosticsResult(
                healthy: true,
                latencyMs: latencyMilliseconds(since: start),
                error: nil
            )
        } catch let error as APIError {
            diagnosticsResult = DiagnosticsResult(
                healthy: false,
                latencyMs: latencyMilliseconds(since: start),
                error: error.userMessage
            )
        } catch {
            diagnosticsResult = DiagnosticsResult(
                healthy: false,
                latencyMs: 0,
                error: error.localizedDescription
            )
        }

        isTesting = false
    }

    private func loadProviderAuthConfigs() async {
        guard let client = appModel.client else {
            providerAuthConfigs = []
            return
        }

        do {
            providerAuthConfigs = try await ProviderAuthService(client: client).loadConfig()
        } catch {
            providerAuthConfigs = []
        }
    }

    private func presentProviderAuthEditor(_ provider: OAuthProviderConfigKind) {
        providerAuthDraft.apply(record: providerAuthConfigs.first(where: { $0.provider == provider.rawValue }))
        providerAuthSaveErrorMessage = nil
        presentedProviderAuthProvider = provider
    }

    private func dismissProviderAuthEditor() {
        presentedProviderAuthProvider = nil
        providerAuthSaveErrorMessage = nil
        providerAuthDraft.clearSensitiveFields()
    }

    private func saveProviderAuthConfig() async {
        guard let client = appModel.client, let provider = presentedProviderAuthProvider else { return }

        isSavingProviderAuth = true
        providerAuthSaveErrorMessage = nil
        defer { isSavingProviderAuth = false }

        do {
            providerAuthConfigs = try await ProviderAuthService(client: client).saveConfig(
                provider: provider.rawValue,
                input: ProviderAuthConfigUpdateInput(
                    clientId: providerAuthDraft.normalizedClientId,
                    clientSecret: providerAuthDraft.normalizedClientSecret,
                    clearStoredSecret: providerAuthDraft.clearStoredSecret
                )
            )
            providerAuthDraft.clearSensitiveFields()
            presentedProviderAuthProvider = nil
            NotificationCenter.default.post(name: .popeyeInvalidation, object: InvalidationSignal.connections)
        } catch let error as APIError {
            providerAuthSaveErrorMessage = error.userMessage
        } catch {
            providerAuthSaveErrorMessage = error.localizedDescription
        }
    }

    private func latencyMilliseconds(since start: ContinuousClock.Instant) -> Int {
        let elapsed = ContinuousClock.now - start
        return Int(elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000)
    }
}
