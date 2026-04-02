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
                    sidebar
                        .frame(minWidth: 240, idealWidth: 280, maxWidth: 320)
                    editorPane
                        .frame(minWidth: 420)
                    previewPane
                        .frame(minWidth: 340)
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

    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(emptyTitle)
                        .font(.headline)
                    Text("\(store.documents.count) document\(store.documents.count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await store.load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.plain)
            }
            .padding(16)

            Divider()

            if store.documents.isEmpty {
                EmptyStateView(icon: "doc.text", title: emptyTitle, description: emptyDescription)
            } else {
                List(store.documents) { document in
                    Button {
                        store.requestSelection(document.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(document.title)
                                    .font(.headline)
                                Spacer()
                                if document.critical {
                                    StatusBadge(state: "critical")
                                }
                            }
                            Text(document.subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(document.filePath)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(store.selectedDocumentID == document.id ? Color.accentColor.opacity(0.12) : .clear)
                }
                .listStyle(.sidebar)
            }
        }
    }

    @ViewBuilder
    private var editorPane: some View {
        if let document = store.selectedDocument {
            VStack(alignment: .leading, spacing: 0) {
                editorHeader(document)
                Divider()
                MacMarkdownEditor(text: $store.draftMarkdown)
            }
        } else {
            ContentUnavailableView("Select a document", systemImage: "doc.text")
        }
    }

    private func editorHeader(_ document: CuratedDocumentRecordDTO) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(document.title)
                            .font(.title3.bold())
                        if store.isDirty {
                            Text("Unsaved")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(.orange.opacity(0.15))
                                .foregroundStyle(.orange)
                                .clipShape(Capsule())
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
                    Button("Discard") {
                        store.discardChanges()
                    }
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

    @ViewBuilder
    private var previewPane: some View {
        VStack(alignment: .leading, spacing: 0) {
            previewHeader
            Divider()
            if let proposal = store.proposal {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let conflictMessage = proposal.conflictMessage {
                            Label(conflictMessage, systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                        }
                        Text(proposal.diffPreview)
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .background(.background.secondary)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                        if proposal.redactionApplied {
                            Label("Sensitive patterns were redacted before save.", systemImage: "eye.slash")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        if let receipt = store.lastSaveReceipt {
                            receiptSection(receipt)
                        }
                    }
                    .padding(16)
                }
            } else {
                MarkdownPreviewView(markdown: store.previewMarkdown)
            }
        }
    }

    private var previewHeader: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(store.proposal == nil ? "Rendered Preview" : "Diff Preview")
                    .font(.headline)
                Text(store.proposal == nil ? "How the markdown will read when saved." : "Review the exact changes before applying them.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if store.proposalMatchesDraft, store.proposal?.status == "ready" {
                Button(store.selectedDocument?.critical == true ? "Confirm Save" : "Apply Save") {
                    Task { await store.applySave() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.isSaving)
            }
        }
        .padding(16)
    }

    private var primaryActionTitle: String {
        if store.proposalMatchesDraft, store.proposal?.status == "ready" {
            return store.selectedDocument?.critical == true ? "Confirm Save" : "Apply Save"
        }
        return "Review Changes"
    }

    private func receiptSection(_ receipt: MutationReceiptDTO) -> some View {
        InspectorSection(title: "Latest Save Receipt") {
            DetailRow(label: "Summary", value: receipt.summary)
            DetailRow(label: "When", value: DateFormatting.formatAbsoluteTime(receipt.createdAt))
            Text(receipt.details)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}
