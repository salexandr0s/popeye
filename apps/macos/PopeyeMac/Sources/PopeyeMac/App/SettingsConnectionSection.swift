import SwiftUI
import PopeyeAPI

struct SettingsConnectionSection: View {
    let baseURL: String
    let connectionState: ConnectionState
    let isConnected: Bool
    let sseConnected: Bool
    let disconnect: () -> Void

    var body: some View {
        Section("Connection") {
            LabeledContent("Base URL") {
                Text(baseURL)
                    .textSelection(.enabled)
            }

            LabeledContent("Status") {
                statusLabel
            }

            if isConnected {
                LabeledContent("Live Updates") {
                    liveUpdatesLabel
                }

                Button("Disconnect", role: .destructive, action: disconnect)
            }
        }
    }

    @ViewBuilder
    private var statusLabel: some View {
        switch connectionState {
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

    @ViewBuilder
    private var liveUpdatesLabel: some View {
        if sseConnected {
            Label("Active", systemImage: "bolt.circle.fill")
                .foregroundStyle(.green)
        } else {
            Label("Inactive", systemImage: "bolt.slash.circle")
                .foregroundStyle(.secondary)
        }
    }
}
