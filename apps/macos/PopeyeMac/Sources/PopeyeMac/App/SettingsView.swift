import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var appModel

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
        .frame(width: 450, height: 380)
    }

    private func disconnect() {
        appModel.disconnect()
    }
}

extension Bundle {
    var shortVersion: String {
        infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    var buildNumber: String {
        infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }
}

#Preview {
    SettingsView()
        .environment(AppModel())
}
