import SwiftUI
import PopeyeAPI

struct CalendarAccountOperationsSection: View {
    let syncResult: CalendarSyncResultDTO?

    var body: some View {
        InspectorSection(title: "Account Operations") {
            if let syncResult {
                DetailRow(label: "Synced", value: "\(syncResult.eventsSynced)")
                DetailRow(label: "Updated", value: "\(syncResult.eventsUpdated)")
                if syncResult.errors.isEmpty == false {
                    DetailRow(label: "Errors", value: syncResult.errors.joined(separator: "\n"))
                }
            } else {
                Text("Sync the selected calendar account to refresh local event data and review the latest operation results here.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
