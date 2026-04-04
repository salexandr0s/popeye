import SwiftUI
import PopeyeAPI

struct CuratedDocumentEditorView: View {
    @Bindable var store: CuratedDocumentsStore
    let emptyTitle: String
    let emptyDescription: String

    var body: some View {
        Group {
            if store.isLoading && store.documents.isEmpty {
                LoadingStateView(title: "Loading documents…")
            } else if let errorMessage = store.errorMessage, store.documents.isEmpty {
                EmptyStateView(icon: "doc.text", title: emptyTitle, description: errorMessage)
            } else {
                HSplitView {
                    CuratedDocumentSidebar(
                        store: store,
                        emptyTitle: emptyTitle,
                        emptyDescription: emptyDescription
                    )
                    .popeyeSplitPane(minWidth: 240, idealWidth: 280, maxWidth: 320)

                    if let document = store.selectedDocument {
                        CuratedDocumentEditorPane(store: store, document: document)
                            .popeyeSplitPane(minWidth: 420)
                        CuratedDocumentPreviewPane(store: store)
                            .popeyeSplitPane(minWidth: 340)
                    } else {
                        ContentUnavailableView("Select a document", systemImage: "doc.text")
                            .popeyeSplitPane()
                    }
                }
            }
        }
        .alert("Discard unsaved changes?", isPresented: $store.showDiscardAlert) {
            Button("Discard Changes", role: .destructive) {
                store.confirmDiscardAndSwitch()
            }
            Button("Keep Editing", role: .cancel) {
                store.cancelPendingSelection()
            }
        } message: {
            Text("Switching documents will discard the unsaved edits in the current draft.")
        }
    }
}
