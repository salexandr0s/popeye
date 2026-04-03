import SwiftUI
import PopeyeAPI

struct JobsInMotionPanel: View {
    @Bindable var store: CommandCenterStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Jobs in Motion")
                .font(.headline)
                .foregroundStyle(.secondary)

            if store.nonTerminalJobs.isEmpty {
                emptyState
            } else {
                jobsList
            }
        }
    }

    private var jobsList: some View {
        VStack(spacing: 0) {
            ForEach(store.nonTerminalJobs) { job in
                Button {
                    selectJob(job)
                } label: {
                    jobRow(job)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Job for \(store.taskTitle(for: job.taskId))")
                .accessibilityValue(jobAccessibilityValue(for: job))
                .accessibilityHint("Opens job details")
                .contextMenu {
                    Button("Inspect Job") {
                        selectJob(job)
                    }
                    Button("Copy Job ID") {
                        Clipboard.copy(job.id)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(rowBackground(for: job))

                if job.id != store.nonTerminalJobs.last?.id {
                    Divider().padding(.leading, 8)
                }
            }
        }
        .background(.background)
        .clipShape(.rect(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(.separator, lineWidth: 0.5)
        }
    }

    private func jobRow(_ job: JobRecordDTO) -> some View {
        HStack(spacing: 8) {
            StatusBadge(state: job.status)
            Text(store.taskTitle(for: job.taskId))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer()
            if job.retryCount > 0 {
                Text("retry \(job.retryCount)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.secondary.opacity(0.1))
                    .clipShape(.capsule)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    private func rowBackground(for job: JobRecordDTO) -> some View {
        Group {
            if isSelected(job) {
                Color.accentColor.opacity(0.1)
            } else {
                Color.clear
            }
        }
    }

    private var emptyState: some View {
        Text("No jobs in progress")
            .foregroundStyle(.tertiary)
            .font(.callout)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 20)
    }

    private func selectJob(_ job: JobRecordDTO) {
        store.selectedItem = .job(job.id)
    }

    private func isSelected(_ job: JobRecordDTO) -> Bool {
        if case .job(job.id) = store.selectedItem {
            true
        } else {
            false
        }
    }

    private func jobAccessibilityValue(for job: JobRecordDTO) -> String {
        var parts = ["Status \(job.status)"]
        if job.retryCount > 0 {
            parts.append("Retry \(job.retryCount)")
        }
        if isSelected(job) {
            parts.append("Selected")
        }
        return parts.joined(separator: ", ")
    }
}
