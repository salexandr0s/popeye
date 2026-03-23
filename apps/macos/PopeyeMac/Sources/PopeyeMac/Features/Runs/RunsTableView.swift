import SwiftUI
import PopeyeAPI

struct RunsTableView: View {
    @Bindable var store: RunsStore

    var body: some View {
        Table(store.filteredRuns, selection: $store.selectedRunId, sortOrder: $store.sortOrder) {
            TableColumn("State", value: \.state) { run in
                StatusBadge(state: run.state)
            }
            .width(min: 80, ideal: 110)

            TableColumn("Task", value: \.taskId) { run in
                Text(store.taskTitle(for: run.taskId))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            TableColumn("Workspace", value: \.workspaceId) { run in
                Text(IdentifierFormatting.formatShortID(run.workspaceId))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .width(min: 80, ideal: 100)

            TableColumn("Started", value: \.startedAt) { run in
                Text(DateFormatting.formatRelativeTime(run.startedAt))
                    .font(.caption)
            }
            .width(min: 70, ideal: 90)

            TableColumn("Finished") { run in
                if let finished = run.finishedAt {
                    Text(DateFormatting.formatRelativeTime(finished))
                        .font(.caption)
                } else {
                    Text("--")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .width(min: 70, ideal: 90)
        }
        .contextMenu(forSelectionType: RunRecordDTO.ID.self) { ids in
            if let id = ids.first, let run = store.runs.first(where: { $0.id == id }) {
                Button("Copy Run ID") { Clipboard.copy(run.id) }
                Button("Copy CLI Command") { Clipboard.copy("pop run inspect \(run.id)") }
                Divider()
                if MutationEligibility.canCancelRun(state: run.state) {
                    Button("Cancel Run", role: .destructive) {
                        Task { await store.cancelRun(id: run.id) }
                    }
                }
                if MutationEligibility.canRetryRun(state: run.state) {
                    Button("Retry Run") {
                        Task { await store.retryRun(id: run.id) }
                    }
                }
            }
        }
        .onChange(of: store.sortOrder) { _, newOrder in
            store.sort(by: newOrder)
        }
        .onChange(of: store.selectedRunId) { _, newId in
            handleSelectionChange(newId)
        }
    }

    private func handleSelectionChange(_ newId: String?) {
        guard let id = newId else {
            store.selectedRunDetail = nil
            return
        }
        Task { await store.loadDetail(id: id) }
    }
}
