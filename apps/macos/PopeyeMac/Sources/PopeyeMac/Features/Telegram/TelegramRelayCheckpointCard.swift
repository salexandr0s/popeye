import SwiftUI
import PopeyeAPI

struct TelegramRelayCheckpointCard: View {
    let checkpoint: TelegramRelayCheckpointDTO?

    var body: some View {
        GroupBox {
            if let checkpoint {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                            .foregroundStyle(.secondary)
                        Text("Relay Checkpoint")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    DetailRow(label: "Relay Key", value: checkpoint.relayKey)
                    DetailRow(label: "Last Update ID", value: String(checkpoint.lastAcknowledgedUpdateId))
                    DetailRow(label: "Updated", value: DateFormatting.formatRelativeTime(checkpoint.updatedAt))
                }
            } else {
                HStack {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .foregroundStyle(.tertiary)
                    Text("No relay checkpoint")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.horizontal)
    }
}
