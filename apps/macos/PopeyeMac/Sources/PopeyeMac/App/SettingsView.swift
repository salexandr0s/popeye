import SwiftUI
import PopeyeAPI

struct SettingsView: View {
    @Environment(AppModel.self) private var appModel
    @State private var diagnosticsResult: DiagnosticsResult?
    @State private var isTesting = false

    var body: some View {
        @Bindable var model = appModel
        Form {
            Section("Connection") {
                LabeledContent("Base URL") {
                    Text(appModel.baseURL)
                        .textSelection(.enabled)
                }

                LabeledContent("Status") {
                    switch appModel.connectionState {
                    case .connected:
                        Label("Connected", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    case .disconnected:
                        Label("Disconnected", systemImage: "circle")
                            .foregroundStyle(.secondary)
                    case .connecting:
                        Label("Connecting…", systemImage: "arrow.trianglehead.2.counterclockwise")
                            .foregroundStyle(.secondary)
                    case .failed:
                        Label("Connection Failed", systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }

                if appModel.isConnected {
                    LabeledContent("Live Updates") {
                        if appModel.sseConnected {
                            Label("Active", systemImage: "bolt.circle.fill")
                                .foregroundStyle(.green)
                        } else {
                            Label("Inactive", systemImage: "bolt.slash.circle")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if appModel.isConnected {
                    Button("Disconnect", role: .destructive, action: disconnect)
                }
            }

            Section("Diagnostics") {
                Button(isTesting ? "Testing…" : "Test Connection") {
                    Task { await testConnection() }
                }
                .disabled(isTesting || !appModel.isConnected)

                if let result = diagnosticsResult {
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

            Section("Refresh") {
                Toggle("Enable SSE live updates", isOn: $model.sseEnabled)
                Picker("Fallback poll interval", selection: $model.pollIntervalSeconds) {
                    Text("5 seconds").tag(5)
                    Text("10 seconds").tag(10)
                    Text("15 seconds").tag(15)
                    Text("30 seconds").tag(30)
                }
            }

            Section("About") {
                LabeledContent("App", value: "PopeyeMac")
                LabeledContent("Version", value: Bundle.main.shortVersion)
                LabeledContent("Build", value: Bundle.main.buildNumber)
            }
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
            let elapsed = ContinuousClock.now - start
            let ms = Int(elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000)
            diagnosticsResult = DiagnosticsResult(healthy: true, latencyMs: ms, error: nil)
        } catch let error as APIError {
            let elapsed = ContinuousClock.now - start
            let ms = Int(elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000)
            diagnosticsResult = DiagnosticsResult(healthy: false, latencyMs: ms, error: error.userMessage)
        } catch {
            diagnosticsResult = DiagnosticsResult(healthy: false, latencyMs: 0, error: error.localizedDescription)
        }
        isTesting = false
    }
}

#Preview {
    SettingsView()
        .environment(AppModel())
}
