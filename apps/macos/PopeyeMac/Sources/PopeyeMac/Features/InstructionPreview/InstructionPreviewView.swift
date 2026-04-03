import SwiftUI
import PopeyeAPI

struct InstructionPreviewView: View {
    @Bindable var store: InstructionPreviewStore
    @Environment(AppModel.self) private var appModel
    @State private var displayMode: InstructionPreviewDisplayMode = .compiled

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            InstructionPreviewScopeBar(
                displayMode: $displayMode,
                scopeInput: $store.scopeInput,
                workspaceName: appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID,
                isLoading: store.isLoading,
                load: { Task { await store.loadPreview() } }
            )
            Divider()
            contentArea
        }
        .navigationTitle("Instructions")
        .task(id: appModel.selectedWorkspaceID) {
            store.adoptWorkspaceScope(appModel.selectedWorkspaceID)
            await store.loadDefaultPreviewIfNeeded()
            if displayMode == .curated {
                await store.loadCuratedDocumentsIfNeeded()
            }
        }
        .popeyeRefreshable(invalidationSignals: [.general]) {
            await store.loadPreview()
            if displayMode == .curated {
                await store.curatedDocuments.load()
            }
        }
        .onChange(of: displayMode) { _, newMode in
            guard newMode == .curated else { return }
            Task { await store.loadCuratedDocumentsIfNeeded() }
        }
    }

    @ViewBuilder
    private var contentArea: some View {
        if displayMode == .curated {
            CuratedDocumentEditorView(
                store: store.curatedDocuments,
                emptyTitle: "Instruction Documents",
                emptyDescription: "Workspace instructions, project instructions, soul, and identity files appear here for governed editing."
            )
        } else if store.isLoading {
            LoadingStateView(title: "Loading instructions...")
        } else if let error = store.error {
            ContentUnavailableView(
                "Instruction Preview Unavailable",
                systemImage: "exclamationmark.triangle",
                description: Text(error)
            )
        } else if let preview = store.preview {
            InstructionCompiledPreviewPane(preview: preview)
        } else {
            EmptyStateView(
                icon: "doc.plaintext",
                title: "Instruction Preview",
                description: "Enter a scope and press Load to see the compiled instructions an agent receives."
            )
        }
    }
}
