import SwiftUI
import PopeyeAPI

struct CalendarDigestSection: View {
    let digest: CalendarDigestDTO

    var body: some View {
        InspectorSection(title: "Agenda Summary") {
            DetailRow(label: "Today", value: "\(digest.todayEventCount)")
            DetailRow(label: "Upcoming", value: "\(digest.upcomingCount)")
            Text(digest.summaryMarkdown)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}
