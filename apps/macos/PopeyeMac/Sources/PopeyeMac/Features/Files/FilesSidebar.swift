import SwiftUI
import PopeyeAPI

struct FilesSidebar: View {
    @Binding var selectedRootID: String?
    let workspaceName: String
    let roots: [FileRootDTO]
    let isMutating: Bool
    let editRoot: (FileRootDTO) -> Void
    let reindexRoot: (FileRootDTO) -> Void
    let deleteRoot: (FileRootDTO) -> Void

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Text(workspaceName)
                    .font(.headline)
                Text("Workspace file roots and write-intent visibility")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)

            Divider()

            if roots.isEmpty {
                EmptyStateView(
                    icon: "folder",
                    title: "No file roots",
                    description: "Configured file roots will appear here once the workspace is indexed."
                )
            } else {
                List(roots, selection: $selectedRootID) { root in
                    row(for: root)
                        .tag(root.id)
                        .contextMenu {
                            Button("Edit Root", systemImage: "pencil") {
                                editRoot(root)
                            }

                            Button("Reindex", systemImage: "arrow.clockwise") {
                                reindexRoot(root)
                            }
                            .disabled(isMutating)

                            Divider()

                            Button("Delete Root", systemImage: "trash", role: .destructive) {
                                deleteRoot(root)
                            }
                            .disabled(isMutating)
                        }
                }
                .listStyle(.sidebar)
            }
        }
    }

    private func row(for root: FileRootDTO) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(root.label)
                    .font(.headline)
                Spacer()
                StatusBadge(state: root.enabled ? "enabled" : "disabled")
            }
            Text(root.rootPath)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Text(root.lastIndexedAt.map(DateFormatting.formatRelativeTime) ?? "Never indexed")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(root.label)
        .accessibilityValue(accessibilityValue(for: root))
    }

    private func accessibilityValue(for root: FileRootDTO) -> String {
        [
            root.enabled ? "Enabled" : "Disabled",
            root.rootPath,
            root.lastIndexedAt.map { "Indexed \(DateFormatting.formatRelativeTime($0))" } ?? "Never indexed"
        ]
        .joined(separator: ", ")
    }
}
