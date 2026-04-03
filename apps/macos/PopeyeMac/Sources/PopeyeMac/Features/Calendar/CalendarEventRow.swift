import SwiftUI
import PopeyeAPI

struct CalendarEventRow: View {
    let event: CalendarEventDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(event.title)
                .font(.headline)
                .lineLimit(1)

            Text(DateFormatting.formatAbsoluteTime(event.startTime))
                .font(.callout)
                .foregroundStyle(.secondary)

            if event.location.isEmpty == false {
                Text(event.location)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(event.title)
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: String {
        [
            "Starts \(DateFormatting.formatAbsoluteTime(event.startTime))",
            event.location.isEmpty ? nil : event.location
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
    }
}
