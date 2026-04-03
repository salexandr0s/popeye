import SwiftUI
import PopeyeAPI

struct PeopleActivitySection: View {
    let activity: [PersonActivityRollupDTO]

    var body: some View {
        InspectorSection(title: "Activity") {
            if activity.isEmpty {
                Text("No recent rollups for this person yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(activity) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(entry.domain.capitalized)
                                .font(.headline)
                            Spacer()
                            Text("\(entry.count)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text(entry.summary)
                            .foregroundStyle(.secondary)
                        Text(DateFormatting.formatRelativeTime(entry.lastSeenAt))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
