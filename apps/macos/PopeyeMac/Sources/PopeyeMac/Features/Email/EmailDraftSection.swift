import SwiftUI
import PopeyeAPI

struct EmailDraftSection: View {
    let drafts: [EmailDraftDTO]
    let isLoadingDetail: Bool
    let detailError: APIError?
    let canEditDrafts: Bool
    let editDraft: (EmailDraftDTO) -> Void

    var body: some View {
        InspectorSection(title: "Drafts") {
            if drafts.isEmpty {
                Text("Create a draft to keep a reusable Popeye-managed draft in this mailbox, or seed one from Reply, Reply All, or Forward in a selected thread. Send remains intentionally out of scope.")
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(drafts) { draft in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(draft.subject.isEmpty ? "Untitled Draft" : draft.subject)
                                        .font(.headline)
                                    Text(recipientSummary(draft))
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                    Text(DateFormatting.formatAbsoluteTime(draft.updatedAt))
                                        .font(.caption)
                                        .foregroundStyle(.tertiary)
                                }

                                Spacer()

                                Button("Edit", systemImage: "square.and.pencil") {
                                    editDraft(draft)
                                }
                                .disabled(!canEditDrafts)
                            }

                            if draft.bodyPreview.isEmpty == false {
                                Text(draft.bodyPreview)
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                        }
                        .padding(.vertical, 4)

                        if draft.id != drafts.last?.id {
                            Divider()
                        }
                    }
                }
            }

            if isLoadingDetail {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Loading draft body…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            if let detailError {
                Text(detailError.userMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
    }

    private func recipientSummary(_ draft: EmailDraftDTO) -> String {
        let primary = draft.to.isEmpty ? "No recipients" : draft.to.joined(separator: ", ")
        if draft.cc.isEmpty {
            return primary
        }
        return "\(primary) · Cc: \(draft.cc.joined(separator: ", "))"
    }
}
