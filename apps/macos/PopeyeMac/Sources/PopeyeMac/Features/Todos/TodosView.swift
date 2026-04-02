import SwiftUI
import PopeyeAPI

struct TodosView: View {
    @Bindable var store: TodosStore
    @Environment(AppModel.self) private var appModel
    @State private var debouncer = ReloadDebouncer()

    var body: some View {
        Group {
            if store.isLoading && store.accounts.isEmpty {
                LoadingStateView(title: "Loading todos…")
            } else if let error = store.error, store.accounts.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                HSplitView {
                    sidebar
                        .frame(minWidth: 300, idealWidth: 340, maxWidth: 380)
                    detail
                        .frame(minWidth: 520)
                }
            }
        }
        .navigationTitle("Todos")
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onChange(of: store.selectedItemID) { _, newValue in
            guard let newValue else { return }
            Task { await store.loadItem(id: newValue) }
        }
        .onChange(of: store.selectedAccountID) { oldValue, newValue in
            guard oldValue != newValue, oldValue != nil else { return }
            store.selectedProjectName = nil
            Task { await store.load() }
        }
        .onChange(of: store.selectedProjectName) { _, _ in
            Task { await store.load() }
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

    private var sidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Account", selection: $store.selectedAccountID) {
                    ForEach(store.accounts) { account in
                        Text(account.displayName).tag(Optional(account.id))
                    }
                }
                .pickerStyle(.menu)

                Picker("Project", selection: $store.selectedProjectName) {
                    Text("All Projects").tag(Optional<String>.none)
                    ForEach(store.projects) { project in
                        Text(project.name).tag(Optional(project.name))
                    }
                }
                .pickerStyle(.menu)
            }
            .padding(16)

            Divider()

            if store.items.isEmpty {
                EmptyStateView(icon: "checklist", title: "No todo items", description: "Todo items will appear here once an account is available.")
            } else {
                List(store.items, selection: $store.selectedItemID) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(item.title)
                                .font(.headline)
                                .lineLimit(2)
                            Spacer()
                            StatusBadge(state: item.status)
                        }
                        if let projectName = item.projectName {
                            Text(projectName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let dueDate = item.dueDate {
                            Text(dueDate)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                    .tag(item.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private var detail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let digest = store.digest {
                    InspectorSection(title: "Planning Summary") {
                        DetailRow(label: "Pending", value: "\(digest.pendingCount)")
                        DetailRow(label: "Overdue", value: "\(digest.overdueCount)")
                        DetailRow(label: "Completed today", value: "\(digest.completedTodayCount)")
                        Text(digest.summaryMarkdown)
                            .foregroundStyle(.secondary)
                    }
                }

                if let item = store.selectedItem {
                    InspectorSection(title: item.title) {
                        DetailRow(label: "Priority", value: "P\(item.priority)")
                        DetailRow(label: "Status", value: item.status.capitalized)
                        DetailRow(label: "Project", value: item.projectName ?? "None")
                        DetailRow(label: "Due", value: item.dueDate ?? "Unscheduled")
                        if item.description.isEmpty == false {
                            Text(item.description)
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    ContentUnavailableView("Select a todo", systemImage: "checklist.checked")
                        .frame(maxWidth: .infinity, minHeight: 320)
                }
            }
            .padding(20)
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
