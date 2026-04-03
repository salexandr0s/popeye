import SwiftUI
import PopeyeAPI

struct DashboardHeaderRow: View {
    let lastUpdated: Date?

    var body: some View {
        HStack {
            Text("System Overview")
                .font(.title2.bold())

            Spacer()
            FreshnessPill(lastUpdated: lastUpdated)

            if let lastUpdated {
                Text("Updated \(DateFormatting.formatRelativeTime(lastUpdated))")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}
