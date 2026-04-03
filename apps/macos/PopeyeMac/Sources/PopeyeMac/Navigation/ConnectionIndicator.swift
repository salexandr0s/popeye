import SwiftUI
import PopeyeAPI

struct ConnectionIndicator: View {
    let state: ConnectionState
    var sseConnected: Bool = false

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(dotColor)
                .frame(width: 8, height: 8)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            if sseConnected {
                Text("Live")
                    .font(.caption.bold())
                    .foregroundStyle(.green)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(.green.opacity(0.1))
                    .clipShape(.capsule)
                }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Connection")
        .accessibilityValue(accessibilityValue)
    }

    private var dotColor: Color {
        switch state {
        case .connected: .green
        case .connecting: .orange
        case .disconnected: .gray
        case .failed: .red
        }
    }

    private var label: String {
        switch state {
        case .connected: "Connected"
        case .connecting: "Connecting…"
        case .disconnected: "Disconnected"
        case .failed: "Connection Failed"
        }
    }

    private var accessibilityValue: String {
        sseConnected ? "\(label), live updates connected" : label
    }
}

#Preview {
    VStack(spacing: 12) {
        ConnectionIndicator(state: .connected, sseConnected: true)
        ConnectionIndicator(state: .connected, sseConnected: false)
        ConnectionIndicator(state: .connecting)
        ConnectionIndicator(state: .disconnected)
        ConnectionIndicator(state: .failed(.transportUnavailable))
    }
    .padding()
}
