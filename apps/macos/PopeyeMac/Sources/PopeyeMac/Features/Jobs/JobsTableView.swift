import SwiftUI
import PopeyeAPI

struct JobsTableView: View {
    @Bindable var store: JobsStore

    var body: some View {
        Table(store.filteredJobs, selection: $store.selectedJobId, sortOrder: $store.sortOrder) {
            TableColumn("Status", value: \.status) { job in
                StatusBadge(state: job.status)
            }
            .width(min: 80, ideal: 130)

            TableColumn("Task", value: \.taskId) { job in
                Text(store.taskTitle(for: job.taskId))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            TableColumn("Retries") { job in
                Text("\(job.retryCount)")
                    .font(.callout)
                    .foregroundStyle(job.retryCount > 0 ? .primary : .tertiary)
            }
            .width(min: 50, ideal: 60)

            TableColumn("Available At", value: \.availableAt) { job in
                Text(DateFormatting.formatRelativeTime(job.availableAt))
                    .font(.caption)
            }
            .width(min: 80, ideal: 100)

            TableColumn("Created", value: \.createdAt) { job in
                Text(DateFormatting.formatRelativeTime(job.createdAt))
                    .font(.caption)
            }
            .width(min: 70, ideal: 90)
        }
        .contextMenu(forSelectionType: JobRecordDTO.ID.self) { ids in
            if let id = ids.first, let job = store.jobs.first(where: { $0.id == id }) {
                Button("Copy Job ID") { Clipboard.copy(job.id) }
                Button("Copy Task ID") { Clipboard.copy(job.taskId) }
                Divider()
                if MutationEligibility.canPauseJob(status: job.status) {
                    Button("Pause Job") { Task { await store.pauseJob(id: job.id) } }
                }
                if MutationEligibility.canResumeJob(status: job.status) {
                    Button("Resume Job") { Task { await store.resumeJob(id: job.id) } }
                }
                if MutationEligibility.canEnqueueJob(status: job.status) {
                    Button("Re-enqueue Job") { Task { await store.enqueueJob(id: job.id) } }
                }
            }
        }
        .onChange(of: store.sortOrder) { _, newOrder in
            store.sort(by: newOrder)
        }
        .onChange(of: store.selectedJobId) { _, newId in
            handleSelectionChange(newId)
        }
    }

    private func handleSelectionChange(_ newId: String?) {
        guard let id = newId else {
            store.selectedJobDetail = nil
            return
        }
        Task { await store.loadDetail(id: id) }
    }
}
