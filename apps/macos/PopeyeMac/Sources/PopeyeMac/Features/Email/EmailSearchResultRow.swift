import SwiftUI
import PopeyeAPI

struct EmailSearchResultRow: View {
    let result: EmailSearchResultDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(result.subject.isEmpty ? "(No subject)" : result.subject)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                Text(DateFormatting.formatRelativeTime(result.lastMessageAt))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Text(result.from)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Text(result.snippet)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(result.subject.isEmpty ? "(No subject)" : result.subject)
        .accessibilityValue([result.from, result.snippet, DateFormatting.formatRelativeTime(result.lastMessageAt)].filter { !$0.isEmpty }.joined(separator: ", "))
    }
}
