import SwiftUI
import PopeyeAPI

struct RunEventsTimeline: View {
    let events: [RunEventDTO]

    var body: some View {
        InspectorSection(title: "Events (\(events.count))") {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(sortedEvents) { event in
                    eventRow(event)
                }
            }
        }
    }

    private var sortedEvents: [RunEventDTO] {
        events.sorted { $0.createdAt < $1.createdAt }
    }

    private func eventRow(_ event: RunEventDTO) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(DateFormatting.formatRelativeTime(event.createdAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
                .frame(width: 60, alignment: .trailing)

            StatusBadge(state: event.type)

            Text(truncatedPayload(event.payload))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .truncationMode(.tail)
                .textSelection(.enabled)
        }
    }

    private func truncatedPayload(_ payload: String) -> String {
        if payload.count <= 120 { return payload }
        return String(payload.prefix(120)) + "..."
    }
}
