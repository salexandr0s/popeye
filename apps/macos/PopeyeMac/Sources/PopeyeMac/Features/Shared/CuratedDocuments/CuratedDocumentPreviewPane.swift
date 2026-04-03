import SwiftUI
import PopeyeAPI

struct CuratedDocumentPreviewPane: View {
    @Bindable var store: CuratedDocumentsStore

    var body: some View {
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
                            .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))

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
                    Task {
                        await store.applySave()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.isSaving)
            }
        }
        .padding(16)
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
