import SwiftUI
import PopeyeAPI

struct TodosView: View {
    @Bindable var store: TodosStore
    @Environment(AppModel.self) private var appModel

    var body: some View {
        rootContent
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
        .popeyeRefreshable(invalidationSignals: [.connections, .general]) {
            await store.load()
        }
    }

    @ViewBuilder
    private var rootContent: some View {
        if store.isLoading && store.accounts.isEmpty {
            LoadingStateView(title: "Loading todos…")
        } else if let error = store.error, store.accounts.isEmpty {
            ErrorStateView(error: error, retryAction: reload)
        } else {
            HSplitView {
                TodosSidebar(
                    selectedAccountID: $store.selectedAccountID,
                    selectedProjectName: $store.selectedProjectName,
                    selectedItemID: $store.selectedItemID,
                    accounts: store.accounts,
                    projects: store.projects,
                    items: store.items
                )
                .popeyeSplitPane(minWidth: 300, idealWidth: 340, maxWidth: 380)

                detail
                    .popeyeSplitPane(minWidth: 520)
            }
        }
    }

    private var detail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                if let digest = store.digest {
                    TodosDigestSection(digest: digest)
                }

                if let item = store.selectedItem {
                    TodoItemDetailSection(item: item)
                } else {
                    ContentUnavailableView("Select a todo", systemImage: "checklist.checked")
                        .frame(maxWidth: .infinity, minHeight: 320)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
