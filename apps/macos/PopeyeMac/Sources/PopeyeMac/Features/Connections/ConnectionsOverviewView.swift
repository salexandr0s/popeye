import SwiftUI
import PopeyeAPI

struct ConnectionsOverviewView: View {
    @Bindable var store: ConnectionsStore
    @State private var debouncer = ReloadDebouncer()

    private let summaryColumns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

    var body: some View {
        Group {
            if store.isLoading && store.connections.isEmpty {
                LoadingStateView(title: "Loading connections...")
            } else if store.connections.isEmpty {
                EmptyStateView(
                    icon: "link",
                    title: "No connections",
                    description: "Connections to external services will appear here."
                )
            } else {
                connectionsContent
            }
        }
        .navigationTitle("Connections")
        .task {
            await store.load()
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.connections, .general].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var connectionsContent: some View {
        VStack(spacing: 0) {
            summaryCards
                .padding(16)
            Divider()
            HSplitView {
                connectionsList
                    .frame(minWidth: 350)
                inspectorColumn
                    .frame(minWidth: 300)
            }
        }
    }

    private var summaryCards: some View {
        LazyVGrid(columns: summaryColumns, spacing: 12) {
            DashboardCard(
                label: "Healthy",
                value: "\(store.healthyCount)",
                valueColor: store.healthyCount > 0 ? .green : .secondary
            )
            DashboardCard(
                label: "Degraded",
                value: "\(store.degradedCount)",
                valueColor: store.degradedCount > 0 ? .orange : .secondary
            )
            DashboardCard(
                label: "Error",
                value: "\(store.errorCount)",
                valueColor: store.errorCount > 0 ? .red : .secondary
            )
        }
    }

    private var connectionsList: some View {
        List(store.connections, selection: $store.selectedId) { conn in
            ConnectionRowView(connection: conn)
        }
        .listStyle(.inset)
    }

    @ViewBuilder
    private var inspectorColumn: some View {
        if let conn = store.selectedConnection {
            ConnectionInspector(connection: conn)
        } else {
            Text("Select a connection to inspect")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
