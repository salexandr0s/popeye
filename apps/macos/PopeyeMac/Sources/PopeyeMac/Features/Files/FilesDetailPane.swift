import SwiftUI
import PopeyeAPI

struct FilesDetailPane: View {
    @Bindable var store: FilesStore
    let openMemory: (String) -> Void
    let editRoot: (FileRootDTO) -> Void
    let requestDeleteRoot: () -> Void

    var body: some View {
        if let root = store.selectedRoot {
            ScrollView {
                VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                    FilesRootSection(
                        root: root,
                        lastIndexResult: store.lastIndexResult,
                        isMutating: store.isMutating,
                        phase: store.rootPhase,
                        editRoot: { editRoot(root) },
                        reindexRoot: { Task { await store.reindexSelectedRoot() } },
                        deleteRoot: requestDeleteRoot,
                        retryLoad: { Task { await store.loadRoot(id: root.id) } }
                    )
                    FilesSearchSection(
                        searchText: $store.searchText,
                        searchResults: store.searchResults,
                        phase: store.searchPhase,
                        search: { Task { await store.search() } },
                        selectDocument: { store.selectedDocumentID = $0.documentId }
                    )
                    FilesSelectedDocumentSection(
                        document: store.selectedDocument,
                        phase: store.documentPhase,
                        reloadDocument: {
                            guard let selectedDocumentID = store.selectedDocumentID else { return }
                            Task { await store.loadDocument(id: selectedDocumentID) }
                        },
                        openMemory: openMemory
                    )
                    FilesWriteIntentsSection(
                        writeIntents: Array(store.writeIntents.prefix(8)),
                        isMutating: store.isMutating,
                        reviewIntent: { id, action in
                            Task { await store.reviewWriteIntent(id: id, action: action) }
                        }
                    )
                }
                .padding(PopeyeUI.contentPadding)
            }
        } else {
            ContentUnavailableView("Select a file root", systemImage: "folder.badge.questionmark")
                .frame(maxWidth: .infinity, minHeight: 320)
        }
    }
}
