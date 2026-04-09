import SwiftUI
import PopeyeAPI

struct EmailAccountOperationsSection: View {
    let syncResult: EmailSyncResultDTO?
    let digest: EmailDigestDTO?

    var body: some View {
        InspectorSection(title: "Mailbox Operations") {
            if let syncResult {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Last sync")
                        .font(.subheadline.weight(.semibold))
                    DetailRow(label: "Synced", value: "\(syncResult.synced)")
                    DetailRow(label: "Updated", value: "\(syncResult.updated)")
                    if syncResult.errors.isEmpty == false {
                        DetailRow(label: "Errors", value: syncResult.errors.joined(separator: "\n"))
                    }
                }
            }

            if let digest {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Latest digest")
                        .font(.subheadline.weight(.semibold))
                    DetailRow(label: "Generated", value: DateFormatting.formatAbsoluteTime(digest.generatedAt))
                    DetailRow(label: "Unread", value: "\(digest.unreadCount)")
                    DetailRow(label: "High signal", value: "\(digest.highSignalCount)")
                }
            }

            if syncResult == nil && digest == nil {
                Text("Sync the selected mailbox or generate a digest to review the latest account operations here.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
