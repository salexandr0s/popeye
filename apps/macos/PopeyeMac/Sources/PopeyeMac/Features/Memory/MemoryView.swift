import SwiftUI
import PopeyeAPI

struct MemoryView: View {
    @Bindable var store: MemoryStore
    @Environment(AppModel.self) private var appModel
    @State private var debouncer = ReloadDebouncer()

    var body: some View {
        Group {
            if store.isLoading && store.memories.isEmpty && store.searchResults == nil {
                LoadingStateView(title: "Loading memories...")
            } else {
                memoryContent
            }
        }
        .navigationTitle("Memory")
        .searchable(text: $store.searchText, prompt: "Search memories...")
        .onSubmit(of: .search) {
            Task { await store.search() }
        }
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Picker("Mode", selection: $store.viewMode) {
                    Text("Search").tag(MemoryStore.ViewMode.search)
                    Text("Browse").tag(MemoryStore.ViewMode.browse)
                    Text("Daily").tag(MemoryStore.ViewMode.daily)
                    Text("Curated").tag(MemoryStore.ViewMode.curated)
                }
                .pickerStyle(.segmented)
                .frame(width: 300)
            }

            if store.viewMode == .browse || store.viewMode == .daily {
                ToolbarItem(placement: .automatic) {
                    Picker("Type", selection: $store.typeFilter) {
                        Text("All Types").tag(String?.none)
                        Divider()
                        ForEach(store.availableTypes, id: \.self) { type in
                            Text(type.capitalized).tag(Optional(type))
                        }
                    }
                    .frame(width: 140)
                }
            }
        }
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.loadList()
            if store.viewMode == .curated {
                await store.loadCuratedDocumentsIfNeeded()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task {
                await store.loadList()
                if store.viewMode == .curated {
                    await store.curatedDocuments.load()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.memory, .general].contains(signal) {
                debouncer.schedule {
                    await store.loadList()
                    if store.viewMode == .curated {
                        await store.curatedDocuments.load()
                    }
                }
            }
        }
        .onChange(of: store.selectedMemoryId) { _, newId in
            if let id = newId {
                store.selectDay(for: id)
                Task { await store.loadDetail(id: id) }
            } else {
                store.selectedDetail = nil
                store.memoryHistory = nil
            }
        }
        .onChange(of: store.typeFilter) { _, _ in
            store.ensureSelectedDay()
        }
        .onChange(of: store.viewMode) { _, _ in
            store.ensureSelectedDay()
            if store.viewMode == .curated {
                Task { await store.loadCuratedDocumentsIfNeeded() }
            }
        }
        .sheet(isPresented: $store.showPromotionSheet) {
            if let proposal = store.promotionProposal {
                MemoryPromotionSheet(proposal: proposal, store: store)
            }
        }
    }

    private var memoryContent: some View {
        Group {
            if store.viewMode == .curated {
                listColumn
            } else {
                HSplitView {
                    listColumn
                        .frame(minWidth: 350)
                    inspectorColumn
                        .frame(minWidth: 300)
                }
            }
        }
    }

    @ViewBuilder
    private var listColumn: some View {
        switch store.viewMode {
        case .search:
            MemorySearchResultsView(store: store)
        case .browse:
            MemoryListView(store: store)
        case .daily:
            MemoryDailyView(store: store)
        case .curated:
            CuratedDocumentEditorView(
                store: store.curatedDocuments,
                emptyTitle: "Curated Memory",
                emptyDescription: "Edit MEMORY.md and daily notes here with a governed save flow."
            )
        }
    }

    @ViewBuilder
    private var inspectorColumn: some View {
        if store.viewMode == .curated {
            EmptyView()
        } else if let memory = store.selectedMemory {
            MemoryInspectorView(memory: memory, store: store)
        } else {
            Text("Select a memory to inspect")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
