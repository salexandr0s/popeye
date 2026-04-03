import SwiftUI
import PopeyeAPI

struct SettingsView: View {
    @Environment(AppModel.self) private var appModel
    @State private var diagnosticsResult: DiagnosticsResult?
    @State private var isTesting = false

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
            SettingsAboutSection(
                shortVersion: Bundle.main.shortVersion,
                buildNumber: Bundle.main.buildNumber
            )
        }
        .formStyle(.grouped)
        .frame(minWidth: 450, idealWidth: 480, minHeight: 480)
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

    private func latencyMilliseconds(since start: ContinuousClock.Instant) -> Int {
        let elapsed = ContinuousClock.now - start
        return Int(elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000)
    }
}
