import SwiftUI
import PopeyeAPI

struct InterventionsView: View {
    @Bindable var store: InterventionsStore
    @State private var debouncer = ReloadDebouncer()

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
        .searchable(text: $store.searchText, prompt: "Filter interventions…")
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
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.interventions, .general].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var interventionsContent: some View {
        HSplitView {
            interventionsList
                .frame(minWidth: 350)
            inspectorColumn
                .frame(minWidth: 300)
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
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
