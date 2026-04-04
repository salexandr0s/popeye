import SwiftUI
import PopeyeAPI

struct MemoryView: View {
    @Bindable var store: MemoryStore
    @Environment(AppModel.self) private var appModel

    var body: some View {
        Group {
            if store.loadPhase == .loading && store.memories.isEmpty && store.searchResults == nil {
                LoadingStateView(title: "Loading memories...")
            } else if let error = store.error, store.memories.isEmpty {
                ErrorStateView(error: error) {
                    Task { await reload() }
                }
            } else {
                memoryContent
            }
        }
        .navigationTitle("Memory")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Search memories...")
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
                .frame(minWidth: 260, idealWidth: 300, maxWidth: 360)
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
        .popeyeRefreshable(invalidationSignals: [.memory, .general]) {
            await reload()
        }
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await reload()
        }
        .onChange(of: store.selectedMemoryId) { _, newId in
            if let id = newId {
                store.selectDay(for: id)
                Task {
                    await store.loadDetail(id: id)
                    await store.loadHistory(id: id)
                }
            } else {
                store.selectedDetail = nil
                store.memoryHistory = nil
                store.detailPhase = .idle
                store.historyPhase = .idle
            }
        }
        .onChange(of: store.typeFilter) { _, _ in
            store.ensureSelectedDay()
        }
        .onChange(of: store.viewMode) { _, mode in
            store.ensureSelectedDay()
            if mode == .curated {
                Task { await store.loadCuratedDocumentsIfNeeded() }
            }
        }
        .sheet(item: $store.promotionProposal, content: promotionSheet)
    }

    private var memoryContent: some View {
        Group {
            if store.viewMode == .curated {
                listColumn
            } else {
                HSplitView {
                    listColumn
                        .popeyeSplitPane(minWidth: 340, idealWidth: 400)
                    inspectorColumn
                        .popeyeSplitPane(minWidth: 320, idealWidth: 380)
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
        } else if store.selectedMemoryId != nil {
            LoadingStateView(title: "Loading memory...")
        } else {
            EmptyStateView(
                icon: "brain",
                title: "Select a memory",
                description: "Choose a memory to inspect its details."
            )
        }
    }

    private func reload() async {
        await store.loadList()
        if let selectedMemoryId = store.selectedMemoryId {
            await store.loadDetail(id: selectedMemoryId)
            await store.loadHistory(id: selectedMemoryId)
        }
        if store.viewMode == .curated {
            await store.curatedDocuments.load()
        }
    }

    private func promotionSheet(proposal: MemoryPromotionProposalDTO) -> some View {
        MemoryPromotionSheet(proposal: proposal, store: store)
    }
}
