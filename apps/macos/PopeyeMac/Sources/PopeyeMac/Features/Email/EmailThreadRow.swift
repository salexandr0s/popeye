import SwiftUI
import PopeyeAPI

struct EmailThreadRow: View {
    let thread: EmailThreadDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(thread.subject.isEmpty ? "(No subject)" : thread.subject)
                    .font(.headline)
                    .lineLimit(1)

                Spacer()

                if thread.isUnread {
                    Image(systemName: "circle.fill")
                        .imageScale(.small)
                        .foregroundStyle(.blue)
                        .accessibilityHidden(true)
                }
            }

            Text(thread.snippet)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            Text(DateFormatting.formatRelativeTime(thread.lastMessageAt))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(thread.subject.isEmpty ? "(No subject)" : thread.subject)
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: String {
        [
            thread.isUnread ? "Unread" : "Read",
            thread.snippet,
            DateFormatting.formatRelativeTime(thread.lastMessageAt)
        ]
        .filter { $0.isEmpty == false }
        .joined(separator: ", ")
    }
}
