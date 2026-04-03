import SwiftUI
import PopeyeAPI

struct FilesView: View {
    @Bindable var store: FilesStore
    @Environment(AppModel.self) private var appModel
    @State private var isPresentingCreateRoot = false
    @State private var editingRoot: FileRootDTO?
    @State private var showDeleteConfirmation = false

    var body: some View {
        rootContent
            .navigationTitle("Files")
            .popeyeRefreshable(invalidationSignals: [.general, .memory]) {
                await store.load()
            }
            .toolbar {
                toolbarContent
            }
            .task(id: appModel.selectedWorkspaceID) {
                store.workspaceID = appModel.selectedWorkspaceID
                await store.load()
            }
            .onChange(of: store.selectedRootID) { _, newValue in
                guard let newValue else { return }
                Task { await store.loadRoot(id: newValue) }
            }
            .onChange(of: store.selectedDocumentID) { _, newValue in
                guard let newValue else { return }
                Task { await store.loadDocument(id: newValue) }
            }
            .onChange(of: store.searchText) { _, newValue in
                if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Task { await store.search() }
                }
            }
            .sheet(isPresented: $isPresentingCreateRoot) {
                createRootSheet
            }
            .sheet(item: $editingRoot) { root in
                editRootSheet(root)
            }
            .alert("Remove this file root?", isPresented: $showDeleteConfirmation) {
                Button("Remove", role: .destructive) {
                    Task { await store.deleteSelectedRoot() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The root configuration will be removed from the workspace. Indexed documents and write-intent visibility will disappear after refresh.")
            }
    }

    @ViewBuilder
    private var rootContent: some View {
        if store.isLoading && store.roots.isEmpty {
            LoadingStateView(title: "Loading files…")
        } else if let error = store.error, store.roots.isEmpty {
            ErrorStateView(error: error, retryAction: reload)
        } else {
            splitContent
        }
    }

    private var splitContent: some View {
        HSplitView {
            FilesSidebar(
                selectedRootID: $store.selectedRootID,
                workspaceName: appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID,
                roots: store.roots,
                isMutating: store.isMutating,
                editRoot: { root in
                    editingRoot = root
                },
                reindexRoot: { root in
                    store.selectedRootID = root.id
                    Task { await store.reindexSelectedRoot() }
                },
                deleteRoot: { root in
                    store.selectedRootID = root.id
                    showDeleteConfirmation = true
                }
            )
            .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)

            FilesDetailPane(
                store: store,
                openMemory: { appModel.navigateToMemory(id: $0) },
                editRoot: { root in
                    editingRoot = root
                },
                requestDeleteRoot: {
                    showDeleteConfirmation = true
                }
            )
            .frame(minWidth: 560)
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup {
            Button("Add Root", systemImage: "plus") {
                isPresentingCreateRoot = true
            }
            .help("Add a file root")

            Button("Refresh Files", systemImage: "arrow.clockwise") {
                reload()
            }
            .help("Reload file roots and indexed documents")
        }
    }

    private var createRootSheet: some View {
        FileRootEditorSheet(
            workspaceID: appModel.selectedWorkspaceID,
            existingRoot: nil,
            onCreate: { input in
                Task { await store.createRoot(input: input) }
            },
            onUpdate: { _, _ in }
        )
    }

    private func editRootSheet(_ root: FileRootDTO) -> some View {
        FileRootEditorSheet(
            workspaceID: appModel.selectedWorkspaceID,
            existingRoot: root,
            onCreate: { _ in },
            onUpdate: { id, input in
                Task { await store.updateRoot(id: id, input: input) }
            }
        )
    }

    private func reload() {
        Task { await store.load() }
    }
}
