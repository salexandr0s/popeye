import SwiftUI
import PopeyeAPI

struct JobsView: View {
    @Bindable var store: JobsStore

    var body: some View {
        Group {
            if store.isLoading && store.jobs.isEmpty {
                LoadingStateView(title: "Loading jobs...")
            } else if store.jobs.isEmpty {
                EmptyStateView(
                    icon: "tray.2",
                    title: "No jobs yet",
                    description: "Jobs will appear here when tasks are scheduled."
                )
            } else {
                jobsContent
            }
        }
        .navigationTitle("Jobs")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Filter jobs…")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Picker("Status", selection: $store.statusFilter) {
                    Text("All Statuses").tag(String?.none)
                    Divider()
                    ForEach(store.availableStatuses, id: \.self) { status in
                        Text(status.replacing("_", with: " ").capitalized)
                            .tag(Optional(status))
                    }
                }
                .frame(width: 140)
            }
        }
        .task {
            await store.load()
        }
        .popeyeRefreshable(invalidationSignals: [.jobs, .general]) {
            await store.load()
        }
    }

    private var jobsContent: some View {
        HSplitView {
            JobsTableView(store: store)
                .popeyeSplitPane(minWidth: 400)
            inspectorColumn
                .popeyeSplitPane(minWidth: 300)
        }
    }

    @ViewBuilder
    private var inspectorColumn: some View {
        if let detail = store.selectedJobDetail {
            JobInspectorView(detail: detail, taskTitle: store.taskTitle(for: detail.job.taskId), store: store)
        } else if store.isLoadingDetail {
            LoadingStateView(title: "Loading job details...")
        } else {
            Text("Select a job to inspect")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
