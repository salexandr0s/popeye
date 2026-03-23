import SwiftUI
import PopeyeAPI

struct ReceiptTimelineSection: View {
    let events: [ReceiptTimelineEventDTO]

    var body: some View {
        InspectorSection(title: "Timeline (\(events.count))") {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(sortedEvents) { event in
                    ReceiptEventRow(event: event)
                }
            }
        }
    }

    private var sortedEvents: [ReceiptTimelineEventDTO] {
        events.sorted { $0.at < $1.at }
    }
}
