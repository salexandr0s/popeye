import SwiftUI
import PopeyeAPI

struct ApprovalsView: View {
    @Bindable var store: ApprovalsStore
    @State private var debouncer = ReloadDebouncer()

    private let summaryColumns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

    var body: some View {
        Group {
            if store.isLoading && store.approvals.isEmpty {
                LoadingStateView(title: "Loading approvals...")
            } else if store.approvals.isEmpty {
                EmptyStateView(
                    icon: "checkmark.shield",
                    title: "No approvals",
                    description: "Approval requests appear when runs need authorization for sensitive operations."
                )
            } else {
                approvalsContent
            }
        }
        .navigationTitle("Approvals")
        .searchable(text: $store.searchText, prompt: "Filter approvals…")
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
            if let signal = notification.object as? InvalidationSignal, [.approvals, .general].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var approvalsContent: some View {
        VStack(spacing: 0) {
            summaryCards
                .padding(16)
            Divider()
            HSplitView {
                approvalsList
                    .frame(minWidth: 400)
                inspectorColumn
                    .frame(minWidth: 300)
            }
        }
    }

    private var summaryCards: some View {
        LazyVGrid(columns: summaryColumns, spacing: 12) {
            DashboardCard(
                label: "Pending",
                value: "\(store.pendingCount)",
                valueColor: store.pendingCount > 0 ? .orange : .secondary
            )
            DashboardCard(
                label: "Approved",
                value: "\(store.approvedCount)",
                valueColor: store.approvedCount > 0 ? .green : .secondary
            )
            DashboardCard(
                label: "Denied",
                value: "\(store.deniedCount)",
                valueColor: store.deniedCount > 0 ? .red : .secondary
            )
        }
    }

    private var approvalsList: some View {
        List(store.filteredApprovals, selection: $store.selectedId) { approval in
            ApprovalRowView(approval: approval)
        }
        .listStyle(.inset)
    }

    @ViewBuilder
    private var inspectorColumn: some View {
        if let approval = store.selectedApproval {
            ApprovalInspector(approval: approval, store: store)
        } else {
            Text("Select an approval to inspect")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
