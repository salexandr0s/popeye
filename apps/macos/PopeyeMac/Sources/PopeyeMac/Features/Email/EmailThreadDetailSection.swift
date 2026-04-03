import SwiftUI
import PopeyeAPI

struct EmailThreadDetailSection: View {
    let thread: EmailThreadDTO

    var body: some View {
        InspectorSection(title: thread.subject.isEmpty ? "Thread" : thread.subject) {
            DetailRow(label: "Messages", value: "\(thread.messageCount)")
            DetailRow(label: "Importance", value: thread.importance.capitalized)
            DetailRow(label: "Last updated", value: DateFormatting.formatAbsoluteTime(thread.lastMessageAt))
            Text(thread.snippet)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}
