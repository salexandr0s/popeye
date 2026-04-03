import SwiftUI
import PopeyeAPI

struct SchedulerJobsSection: View {
    let title: String
    let emptyMessage: String
    let jobs: [JobRecordDTO]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)

            if jobs.isEmpty {
                Text(emptyMessage)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
            } else {
                SchedulerJobsTable(jobs: jobs)
            }
        }
    }
}
