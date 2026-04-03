import SwiftUI
import PopeyeAPI

struct CalendarEventDetailSection: View {
    let event: CalendarEventDTO

    var body: some View {
        InspectorSection(title: event.title) {
            DetailRow(label: "Start", value: DateFormatting.formatAbsoluteTime(event.startTime))
            DetailRow(label: "End", value: DateFormatting.formatAbsoluteTime(event.endTime))
            DetailRow(label: "Organizer", value: event.organizer.isEmpty ? "Unknown" : event.organizer)
            DetailRow(label: "Status", value: event.status.capitalized)

            if event.location.isEmpty == false {
                DetailRow(label: "Location", value: event.location)
            }

            if event.description.isEmpty == false {
                Text(event.description)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
    }
}
