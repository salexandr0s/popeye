import SwiftUI
import PopeyeAPI

struct ConnectionsOverviewView: View {
    @Bindable var store: ConnectionsStore

    var body: some View {
        Group {
            if store.loadPhase.isLoading && store.connections.isEmpty {
                LoadingStateView(title: "Loading connections...")
            } else if let error = store.error, store.connections.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                content
            }
        }
        .navigationTitle("Connections")
        .task {
            await store.load()
        }
        .popeyeRefreshable(invalidationSignals: [.connections, .general]) {
            await store.load()
        }
    }

    private var content: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    summaryCards
                    connectProvidersCard
                    if store.connections.isEmpty {
                        EmptyStateView(
                            icon: "link.badge.plus",
                            title: "No connections yet",
                            description: "Start with one of the blessed browser OAuth providers above, then return here for diagnostics, resource rules, and remediation."
                        )
                    } else {
                        splitView
                            .frame(minHeight: 520)
                    }
                }
                .padding(PopeyeUI.contentPadding)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            MutationStateOverlay(state: store.mutationState, dismiss: store.dismissMutation)
                .padding(20)
        }
    }

    private var summaryCards: some View {
        LazyVGrid(columns: PopeyeUI.cardColumns(minimum: 140, maximum: 220), spacing: PopeyeUI.cardSpacing) {
            DashboardCard(
                label: "Connections",
                value: "\(store.connections.count)",
                valueColor: .primary
            )
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
                label: "Needs Attention",
                value: "\(store.errorCount)",
                valueColor: store.errorCount > 0 ? .red : .secondary
            )
        }
    }

    private var connectProvidersCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Connect Blessed Providers")
                .font(.headline)
            Text("Browser OAuth is the blessed path for Gmail, Google Calendar, Google Tasks, and GitHub. Setup remains the quick-start guide; this screen is the deeper admin and remediation surface.")
                .font(.callout)
                .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                ForEach(ConnectionsStore.SupportedOAuthProvider.allCases) { provider in
                    let availability = store.oauthAvailability(for: provider)
                    Button {
                        Task { await store.connect(provider) }
                    } label: {
                        if store.isBusy(.connect(provider.rawValue)) {
                            Text("Connecting \(provider.title)…")
                        } else {
                            Text("Connect \(provider.title)")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled((availability?.isReady == false) || store.busyKey != nil)
                }
            }

            if !store.blockedProviders.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(store.blockedProviders) { provider in
                        Text("\(providerLabel(provider.providerKind)): \(provider.details)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PopeyeUI.contentPadding)
        .background(.background.secondary)
        .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
    }

    private var splitView: some View {
        HSplitView {
            connectionsList
                .popeyeSplitPane(minWidth: 320, idealWidth: 360, maxWidth: 420)
            inspectorColumn
                .popeyeSplitPane(minWidth: 420)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var connectionsList: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Configured Connections")
                .font(.headline)
                .padding(.horizontal, PopeyeUI.contentPadding)
                .padding(.top, PopeyeUI.contentPadding)
            List(store.connections, selection: $store.selectedId) { connection in
                ConnectionRowView(connection: connection)
                    .tag(connection.id)
            }
            .listStyle(.inset)
        }
        .background(.background.secondary)
        .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
    }

    @ViewBuilder
    private var inspectorColumn: some View {
        if let connection = store.selectedConnection {
            ConnectionInspector(store: store, connection: connection)
        } else {
            EmptyStateView(
                icon: "link",
                title: "Select a connection",
                description: "Inspect health, toggle availability, manage resource rules, and run remediation actions from here."
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func reload() {
        Task { await store.load() }
    }

    private func providerLabel(_ kind: String) -> String {
        ConnectionsStore.SupportedOAuthProvider(rawValue: kind)?.title ?? kind
    }
}
