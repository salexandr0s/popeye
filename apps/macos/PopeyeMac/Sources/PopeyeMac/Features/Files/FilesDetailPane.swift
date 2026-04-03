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
                    mutationBanner
                    FilesRootSection(
                        root: root,
                        lastIndexResult: store.lastIndexResult,
                        isMutating: store.isMutating,
                        editRoot: { editRoot(root) },
                        reindexRoot: { Task { await store.reindexSelectedRoot() } },
                        deleteRoot: requestDeleteRoot
                    )
                    FilesSearchSection(
                        searchText: $store.searchText,
                        searchResults: store.searchResults,
                        search: { Task { await store.search() } },
                        selectDocument: { store.selectedDocumentID = $0.documentId }
                    )
                    FilesSelectedDocumentSection(
                        document: store.selectedDocument,
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

    @ViewBuilder
    private var mutationBanner: some View {
        if let message = store.mutationMessage {
            Label(message, systemImage: "checkmark.circle.fill")
                .font(.callout)
                .foregroundStyle(.green)
        } else if let message = store.mutationErrorMessage {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(.orange)
        }
    }
}
