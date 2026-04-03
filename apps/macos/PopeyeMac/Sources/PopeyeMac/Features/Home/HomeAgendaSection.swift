import SwiftUI
import PopeyeAPI

struct HomeAgendaSection: View {
    let summary: HomeSummaryDTO?
    let openCalendar: () -> Void
    let openTodos: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: PopeyeUI.sectionSpacing) {
            InspectorSection(title: "Upcoming Calendar") {
                if let digest = summary?.calendarDigest {
                    DetailRow(label: "Today", value: "\(digest.todayEventCount)")
                    DetailRow(label: "Upcoming", value: "\(digest.upcomingCount)")
                }
                if summary?.upcomingEvents.isEmpty != false {
                    Text("No upcoming events loaded yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach((summary?.upcomingEvents ?? []).prefix(5)) { event in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.title)
                                .font(.headline)
                            Text(DateFormatting.formatAbsoluteTime(event.startTime))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Button("Open Calendar", action: openCalendar)
                    .buttonStyle(.link)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)

            InspectorSection(title: "Upcoming Todos") {
                if let digest = summary?.todoDigest {
                    DetailRow(label: "Pending", value: "\(digest.pendingCount)")
                    DetailRow(label: "Overdue", value: "\(digest.overdueCount)")
                }
                if summary?.upcomingTodos.isEmpty != false {
                    Text("No active todos loaded yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach((summary?.upcomingTodos ?? []).prefix(5)) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(.headline)
                            Text(item.projectName ?? item.status.capitalized)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Button("Open Todos", action: openTodos)
                    .buttonStyle(.link)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }
}
