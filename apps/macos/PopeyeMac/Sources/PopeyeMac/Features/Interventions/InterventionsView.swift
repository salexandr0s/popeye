import SwiftUI
import PopeyeAPI

struct InterventionsView: View {
    @Bindable var store: InterventionsStore

    var body: some View {
        Group {
            if store.isLoading && store.interventions.isEmpty {
                LoadingStateView(title: "Loading interventions...")
            } else if store.interventions.isEmpty {
                EmptyStateView(
                    icon: "exclamationmark.bubble",
                    title: "No interventions",
                    description: "Interventions appear when operator decisions are needed."
                )
            } else {
                interventionsContent
            }
        }
        .navigationTitle("Interventions")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Filter interventions…")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Picker("Status", selection: $store.statusFilter) {
                    Text("All Statuses").tag(String?.none)
                    Divider()
                    ForEach(store.availableStatuses, id: \.self) { status in
                        Text(status.capitalized).tag(Optional(status))
                    }
                }
                .frame(width: 140)
            }
        }
        .task {
            await store.load()
        }
        .popeyeRefreshable(invalidationSignals: [.interventions, .general]) {
            await store.load()
        }
    }

    private var interventionsContent: some View {
        HSplitView {
            interventionsList
                .popeyeSplitPane(minWidth: 350)
            inspectorColumn
                .popeyeSplitPane(minWidth: 300)
        }
    }

    private var interventionsList: some View {
        List(store.filteredInterventions, selection: $store.selectedId) { intv in
            InterventionRowView(intervention: intv)
        }
        .listStyle(.inset)
    }

    @ViewBuilder
    private var inspectorColumn: some View {
        if let intv = store.selectedIntervention {
            InterventionInspector(intervention: intv, store: store)
        } else {
            Text("Select an intervention to inspect")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
