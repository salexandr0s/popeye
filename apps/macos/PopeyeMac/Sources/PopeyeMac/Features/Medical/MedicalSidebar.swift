import SwiftUI
import PopeyeAPI

struct MedicalSidebar: View {
    @Bindable var store: MedicalStore

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Restricted vault")
                    .font(.headline)
                Text(store.vaults.first?.encrypted == true ? "Encrypted at rest" : "Encryption not reported")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)

            Divider()

            if store.imports.isEmpty {
                EmptyStateView(
                    icon: "cross.case",
                    title: "No medical imports",
                    description: "Medical records will appear here once vault data is ingested."
                )
            } else {
                List(store.imports, selection: $store.selectedImportID) { entry in
                    importRow(for: entry)
                        .tag(entry.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private func importRow(for entry: MedicalImportDTO) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(entry.fileName)
                    .font(.headline)
                Spacer()
                StatusBadge(state: entry.status)
            }
            Text(entry.importType.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(DateFormatting.formatAbsoluteTime(entry.importedAt))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.fileName)
        .accessibilityValue(accessibilityValue(for: entry))
    }

    private func accessibilityValue(for entry: MedicalImportDTO) -> String {
        [
            entry.importType.replacingOccurrences(of: "_", with: " ").capitalized,
            "Status \(entry.status.replacingOccurrences(of: "_", with: " "))",
            "Imported \(DateFormatting.formatAbsoluteTime(entry.importedAt))"
        ]
        .joined(separator: ", ")
    }
}
