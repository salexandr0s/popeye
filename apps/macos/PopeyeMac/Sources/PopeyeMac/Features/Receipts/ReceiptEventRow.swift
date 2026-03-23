import SwiftUI
import PopeyeAPI

struct ReceiptEventRow: View {
    let event: ReceiptTimelineEventDTO

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            severityIndicator

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(event.kind)
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    Text(DateFormatting.formatRelativeTime(event.at))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                Text(event.title)
                    .font(.callout)
                    .lineLimit(1)
                if !event.detail.isEmpty {
                    Text(event.detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .truncationMode(.tail)
                }
            }
        }
    }

    private var severityIndicator: some View {
        Circle()
            .fill(severityColor)
            .frame(width: 8, height: 8)
            .padding(.top, 4)
    }

    private var severityColor: Color {
        switch event.severity {
        case "error": .red
        case "warn": .orange
        default: .secondary
        }
    }
}
