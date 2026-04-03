import SwiftUI
import PopeyeAPI

struct TelegramResolutionsSection: View {
    let resolutions: [TelegramResolutionDTO]

    var body: some View {
        InspectorSection(title: "Resolutions") {
            if resolutions.isEmpty {
                Text("No resolutions recorded.")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(resolutions) { resolution in
                        resolutionRow(resolution)
                    }
                }
            }
        }
    }

    private func resolutionRow(_ resolution: TelegramResolutionDTO) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(resolution.action.replacing("_", with: " ").capitalized)
                    .font(.callout.weight(.medium))
                HStack(spacing: 4) {
                    StatusBadge(state: resolution.previousStatus)
                    Image(systemName: "arrow.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    StatusBadge(state: resolution.newStatus)
                }
            }
            if let note = resolution.operatorNote {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text(DateFormatting.formatRelativeTime(resolution.createdAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(8)
        .background(.background)
        .clipShape(.rect(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(.separator, lineWidth: 0.5)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(resolution.action.replacing("_", with: " ").capitalized)
        .accessibilityValue(resolutionSummary(resolution))
    }

    private func resolutionSummary(_ resolution: TelegramResolutionDTO) -> String {
        var parts = [
            "Status changed from \(resolution.previousStatus) to \(resolution.newStatus)",
            DateFormatting.formatRelativeTime(resolution.createdAt)
        ]
        if let note = resolution.operatorNote, !note.isEmpty {
            parts.append("Note \(note)")
        }
        return parts.joined(separator: ", ")
    }
}
