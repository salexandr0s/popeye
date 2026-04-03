import SwiftUI
import PopeyeAPI

struct FilesWriteIntentsSection: View {
    let writeIntents: [FileWriteIntentDTO]
    let isMutating: Bool
    let reviewIntent: (String, String) -> Void

    var body: some View {
        InspectorSection(title: "Recent Write Intents") {
            if writeIntents.isEmpty {
                Text("No pending or recent write intents for this root.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(writeIntents) { intent in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .top) {
                            Text(intent.filePath)
                                .font(.headline)
                            Spacer()
                            StatusBadge(state: intent.status)
                        }
                        Text(intent.intentType.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        Text(intent.diffPreview)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(6)
                            .textSelection(.enabled)
                        Text(DateFormatting.formatRelativeTime(intent.createdAt))
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if intent.status == "pending" {
                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 8) {
                                    actionButtons(for: intent)
                                }

                                VStack(alignment: .leading, spacing: 8) {
                                    actionButtons(for: intent)
                                }
                            }
                        }
                    }
                    .help(rowHelpText(for: intent))
                    .contextMenu {
                        if intent.status == "pending" {
                            Button("Apply", systemImage: "checkmark.circle") {
                                reviewIntent(intent.id, "apply")
                            }
                            .disabled(isMutating)

                            Button("Reject", systemImage: "xmark.circle", role: .destructive) {
                                reviewIntent(intent.id, "reject")
                            }
                            .disabled(isMutating)
                        }
                    }
                }
            }
        }
    }

    private func actionButtons(for intent: FileWriteIntentDTO) -> some View {
        Group {
            Button("Apply") {
                reviewIntent(intent.id, "apply")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isMutating)
            .help("Apply this write intent")

            Button("Reject", role: .destructive) {
                reviewIntent(intent.id, "reject")
            }
            .buttonStyle(.bordered)
            .disabled(isMutating)
            .help("Reject this write intent")
        }
    }

    private func rowHelpText(for intent: FileWriteIntentDTO) -> String {
        if intent.status == "pending" {
            return "Pending write intent for \(intent.filePath). Review the diff preview, then apply or reject it."
        }

        return "\(intent.status.capitalized) write intent for \(intent.filePath)."
    }
}
