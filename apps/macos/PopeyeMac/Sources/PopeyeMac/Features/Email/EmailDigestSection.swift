import SwiftUI
import PopeyeAPI

struct EmailDigestSection: View {
    let digest: EmailDigestDTO

    var body: some View {
        InspectorSection(title: "Digest") {
            DetailRow(label: "Unread", value: "\(digest.unreadCount)")
            DetailRow(label: "High signal", value: "\(digest.highSignalCount)")
            Text(digest.summaryMarkdown)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}
