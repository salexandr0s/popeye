import SwiftUI
import PopeyeAPI

struct EmailDraftSection: View {
    let draft: EmailDraftDTO?
    let canEdit: Bool
    let editDraft: () -> Void

    var body: some View {
        InspectorSection(title: "Drafts") {
            if let draft {
                VStack(alignment: .leading, spacing: 12) {
                    DetailRow(label: "To", value: recipientsText(draft.to))
                    if draft.cc.isEmpty == false {
                        DetailRow(label: "Cc", value: recipientsText(draft.cc))
                    }
                    DetailRow(label: "Subject", value: draft.subject)
                    DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(draft.updatedAt))

                    if draft.bodyPreview.isEmpty == false {
                        Text(draft.bodyPreview)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }

                    Button("Edit Draft", systemImage: "square.and.pencil") {
                        editDraft()
                    }
                    .disabled(!canEdit)
                }
            } else {
                Text("Create a draft to keep a native editing session open for the selected mailbox. Send remains intentionally out of scope.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func recipientsText(_ recipients: [String]) -> String {
        recipients.isEmpty ? "None" : recipients.joined(separator: ", ")
    }
}
