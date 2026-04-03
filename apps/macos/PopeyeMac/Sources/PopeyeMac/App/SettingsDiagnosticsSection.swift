import SwiftUI

struct SettingsDiagnosticsSection: View {
    let result: DiagnosticsResult?
    let isTesting: Bool
    let isConnected: Bool
    let testConnection: () -> Void

    var body: some View {
        Section("Diagnostics") {
            Button(isTesting ? "Testing…" : "Test Connection", action: testConnection)
                .disabled(isTesting || !isConnected)

            if let result {
                LabeledContent("Health") {
                    Label(
                        result.healthy ? "OK" : "Unhealthy",
                        systemImage: result.healthy ? "checkmark.circle.fill" : "xmark.circle.fill"
                    )
                    .foregroundStyle(result.healthy ? .green : .red)
                }

                LabeledContent("Latency") {
                    Text("\(result.latencyMs)ms")
                        .monospacedDigit()
                }

                if let error = result.error {
                    LabeledContent("Error") {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                }
            }
        }
    }
}
