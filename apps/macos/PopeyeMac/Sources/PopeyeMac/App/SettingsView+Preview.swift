import SwiftUI
import PopeyeAPI

@MainActor
private struct SettingsPreviewContainer: View {
    private let appModel: AppModel
    private let diagnosticsResult: DiagnosticsResult?
    private let isTesting: Bool

    init(
        connectionState: ConnectionState,
        sseConnected: Bool = false,
        diagnosticsResult: DiagnosticsResult? = nil,
        isTesting: Bool = false
    ) {
        let appModel = FeaturePreviewFixtures.previewAppModel()
        appModel.connectionState = connectionState
        appModel.sseConnected = sseConnected
        self.appModel = appModel
        self.diagnosticsResult = diagnosticsResult
        self.isTesting = isTesting
    }

    var body: some View {
        SettingsView(
            diagnosticsResult: diagnosticsResult,
            isTesting: isTesting
        )
        .environment(appModel)
        .frame(width: 520, height: 540)
    }
}

#Preview("Settings / Disconnected") {
    SettingsPreviewContainer(connectionState: .disconnected)
}

#Preview("Settings / Connected") {
    SettingsPreviewContainer(connectionState: .connected, sseConnected: true)
}

#Preview("Settings / Diagnostics Success") {
    SettingsPreviewContainer(
        connectionState: .connected,
        sseConnected: true,
        diagnosticsResult: DiagnosticsResult(healthy: true, latencyMs: 42, error: nil)
    )
}

#Preview("Settings / Diagnostics Failure") {
    SettingsPreviewContainer(
        connectionState: .failed(.transportUnavailable),
        diagnosticsResult: DiagnosticsResult(healthy: false, latencyMs: 0, error: APIError.transportUnavailable.userMessage)
    )
}
