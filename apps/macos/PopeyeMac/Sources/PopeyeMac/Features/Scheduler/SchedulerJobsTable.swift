import SwiftUI
import PopeyeAPI

struct SchedulerJobsTable: View {
    let jobs: [JobRecordDTO]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                headerCell("Status", fixedWidth: 120)
                headerCell("Task")
                headerCell("Retries", fixedWidth: 70)
                headerCell("Updated", fixedWidth: 140)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.background.secondary)

            Divider()

            ForEach(jobs) { job in
                HStack(spacing: 0) {
                    StatusBadge(state: job.status)
                        .frame(width: 120, alignment: .leading)
                    Text(IdentifierFormatting.formatShortID(job.taskId))
                        .font(.callout.monospaced())
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(job.retryCount)")
                        .font(.callout.monospacedDigit())
                        .frame(width: 70, alignment: .trailing)
                    Text(DateFormatting.formatRelativeTime(job.updatedAt))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .frame(width: 140, alignment: .trailing)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)

                Divider()
            }
        }
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: PopeyeUI.cardCornerRadius))
        .overlay {
            RoundedRectangle(cornerRadius: PopeyeUI.cardCornerRadius)
                .stroke(.separator, lineWidth: 0.5)
        }
    }

    private func headerCell(_ title: String, fixedWidth: CGFloat? = nil) -> some View {
        Group {
            if let fixedWidth {
                Text(title)
                    .frame(width: fixedWidth, alignment: .leading)
            } else {
                Text(title)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .font(.caption)
        .fontWeight(.medium)
        .foregroundStyle(.secondary)
    }
}
