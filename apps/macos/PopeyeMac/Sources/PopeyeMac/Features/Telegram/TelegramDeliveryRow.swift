import SwiftUI
import PopeyeAPI

struct TelegramDeliveryRow: View {
    let delivery: TelegramDeliveryDTO

    var body: some View {
        HStack(spacing: 8) {
            StatusBadge(state: delivery.status)
            VStack(alignment: .leading, spacing: 2) {
                Text("Chat \(delivery.chatId)")
                    .font(.callout.weight(.medium))
                HStack(spacing: 6) {
                    Text("Msg #\(delivery.telegramMessageId)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let runId = delivery.runId {
                        Text(IdentifierFormatting.formatShortID(runId))
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            Spacer()
            Text(DateFormatting.formatRelativeTime(delivery.createdAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }
}
