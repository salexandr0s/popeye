import SwiftUI
import PopeyeAPI

struct FilesRootSection: View {
    let root: FileRootDTO
    let lastIndexResult: FileIndexResultDTO?
    let isMutating: Bool
    let editRoot: () -> Void
    let reindexRoot: () -> Void
    let deleteRoot: () -> Void

    var body: some View {
        InspectorSection(title: "Root") {
            DetailRow(label: "Path", value: root.rootPath)
            DetailRow(label: "Permission", value: root.permission.capitalized)
            DetailRow(label: "Patterns", value: root.filePatterns.isEmpty ? "All files" : root.filePatterns.joined(separator: ", "))
            DetailRow(label: "Indexed", value: root.lastIndexedAt.map(DateFormatting.formatAbsoluteTime) ?? "Not yet")

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    actionButtons
                }

                VStack(alignment: .leading, spacing: 8) {
                    actionButtons
                }
            }

            if let result = lastIndexResult {
                Divider()
                DetailRow(label: "Indexed", value: "\(result.indexed)")
                DetailRow(label: "Updated", value: "\(result.updated)")
                DetailRow(label: "Skipped", value: "\(result.skipped)")
                DetailRow(label: "Stale", value: "\(result.stale)")
                if result.errors.isEmpty == false {
                    Text(result.errors.joined(separator: "\n"))
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private var actionButtons: some View {
        Group {
            Button("Edit Root") {
                editRoot()
            }
            .buttonStyle(.bordered)
            .help("Edit this file root")

            Button("Reindex") {
                reindexRoot()
            }
            .buttonStyle(.borderedProminent)
            .disabled(isMutating)
            .help("Reindex the selected file root")

            Button("Delete Root", role: .destructive) {
                deleteRoot()
            }
            .buttonStyle(.bordered)
            .disabled(isMutating)
            .help("Remove this file root from the workspace")
        }
    }
}
