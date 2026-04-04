import SwiftUI
import PopeyeAPI

struct RunsView: View {
    @Bindable var store: RunsStore

    var body: some View {
        Group {
            if store.isLoading && store.runs.isEmpty {
                LoadingStateView(title: "Loading runs...")
            } else if store.runs.isEmpty {
                EmptyStateView(
                    icon: "play.circle",
                    title: "No runs yet",
                    description: "Runs will appear here when the daemon starts processing tasks."
                )
            } else {
                runsContent
            }
        }
        .navigationTitle("Runs")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Filter runs…")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Picker("State", selection: $store.stateFilter) {
                    Text("All States").tag(String?.none)
                    Divider()
                    ForEach(store.availableStates, id: \.self) { state in
                        Text(state.replacing("_", with: " ").capitalized)
                            .tag(Optional(state))
                    }
                }
                .frame(width: 140)
            }
        }
        .task {
            await store.load()
        }
        .popeyeRefreshable(invalidationSignals: [.runs, .general]) {
            await store.load()
        }
    }

    private var runsContent: some View {
        HSplitView {
            RunsTableView(store: store)
                .popeyeSplitPane(minWidth: 400)
            inspectorColumn
                .popeyeSplitPane(minWidth: 300)
        }
    }

    @ViewBuilder
    private var inspectorColumn: some View {
        if let detail = store.selectedRunDetail {
            RunInspectorView(detail: detail, taskTitle: store.taskTitle(for: detail.run.taskId), store: store)
        } else if store.isLoadingDetail {
            LoadingStateView(title: "Loading run details...")
        } else {
            Text("Select a run to inspect")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
