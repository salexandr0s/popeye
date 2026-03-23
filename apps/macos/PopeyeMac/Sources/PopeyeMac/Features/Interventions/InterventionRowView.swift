import SwiftUI
import PopeyeAPI

struct InterventionRowView: View {
    let intervention: InterventionDTO

    var body: some View {
        HStack(spacing: 8) {
            StatusBadge(state: intervention.status)
            VStack(alignment: .leading, spacing: 2) {
                Text(intervention.code.replacing("_", with: " ").capitalized)
                    .font(.callout.weight(.medium))
                Text(intervention.reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .truncationMode(.tail)
            }
            Spacer()
            Text(DateFormatting.formatRelativeTime(intervention.createdAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }
}
