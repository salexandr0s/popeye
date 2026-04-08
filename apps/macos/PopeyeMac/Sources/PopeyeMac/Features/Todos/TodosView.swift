import SwiftUI
import PopeyeAPI

struct TodosView: View {
    @Bindable var store: TodosStore
    @Environment(AppModel.self) private var appModel

    var body: some View {
        rootContent
            .navigationTitle("Todos")
            .toolbar {
                ToolbarItemGroup {
                    if !store.accounts.isEmpty {
                        Picker("Account", selection: $store.selectedAccountID) {
                            ForEach(store.accounts) { account in
                                Text(account.displayName).tag(Optional(account.id))
                            }
                        }
                        .frame(width: 200)
                    }

                    Button("Sync", systemImage: "arrow.clockwise") {
                        Task { await store.syncSelectedAccount() }
                    }
                    .disabled(!store.canSyncSelectedAccount)

                    Button("Reconcile", systemImage: "arrow.triangle.branch") {
                        Task { await store.reconcileSelectedAccount() }
                    }
                    .disabled(!store.canReconcileSelectedAccount)

                    Button("Refresh", systemImage: "arrow.triangle.2.circlepath") {
                        Task { await store.load() }
                    }
                }
            }
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
                Task { await store.load() }
            }
            .onChange(of: store.selectedProjectName) { _, _ in
                Task { await store.load() }
            }
            .popeyeRefreshable(invalidationSignals: [.connections, .general]) {
                await store.load()
            }
            .overlay(alignment: .bottomTrailing) {
                MutationStateOverlay(state: store.mutationState, dismiss: store.dismissMutation)
                    .padding(20)
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
                TodoAccountOperationsSection(
                    syncResult: store.visibleSyncResult,
                    reconcileResult: store.visibleReconcileResult
                )

                if let digest = store.digest {
                    TodosDigestSection(digest: digest)
                }

                if let item = store.selectedItem {
                    TodoItemDetailSection(item: item)
                    TodoItemActionsSection(store: store)
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
