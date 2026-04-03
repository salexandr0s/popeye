import SwiftUI
import PopeyeAPI

struct CuratedDocumentEditorPane: View {
    @Bindable var store: CuratedDocumentsStore
    let document: CuratedDocumentRecordDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            editorHeader
            Divider()
            MacMarkdownEditor(text: $store.draftMarkdown)
        }
    }

    private var editorHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(document.title)
                            .font(.title3.bold())
                        if store.isDirty {
                            Text("Unsaved")
                                .font(.caption.bold())
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(.orange.opacity(0.15))
                                .foregroundStyle(.orange)
                                .clipShape(.capsule)
                        }
                    }
                    Text(document.filePath)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(document.updatedAt.map(DateFormatting.formatAbsoluteTime) ?? "Not yet saved")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
                HStack(spacing: 8) {
                    Button("Discard", action: store.discardChanges)
                        .disabled(store.isDirty == false && store.proposal == nil)

                    Button(primaryActionTitle) {
                        Task {
                            if store.proposalMatchesDraft, store.proposal?.status == "ready" {
                                await store.applySave()
                            } else {
                                await store.reviewChanges()
                            }
                        }
                    }
                    .keyboardShortcut("s", modifiers: [.command])
                    .buttonStyle(.borderedProminent)
                    .disabled(store.isSaving || store.isDirty == false && store.proposal == nil)
                }
            }

            if let message = store.saveMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.green)
            } else if let errorMessage = store.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .padding(16)
    }

    private var primaryActionTitle: String {
        if store.proposalMatchesDraft, store.proposal?.status == "ready" {
            store.selectedDocument?.critical == true ? "Confirm Save" : "Apply Save"
        } else {
            "Review Changes"
        }
    }
}
