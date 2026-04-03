import SwiftUI
import PopeyeAPI

struct TodosDigestSection: View {
    let digest: TodoDigestDTO

    var body: some View {
        InspectorSection(title: "Planning Summary") {
            DetailRow(label: "Pending", value: "\(digest.pendingCount)")
            DetailRow(label: "Overdue", value: "\(digest.overdueCount)")
            DetailRow(label: "Completed today", value: "\(digest.completedTodayCount)")
            Text(digest.summaryMarkdown)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}
