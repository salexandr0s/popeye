import SwiftUI
import PopeyeAPI

struct FinanceSidebar: View {
    @Bindable var store: FinanceStore

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
                    icon: "creditcard",
                    title: "No finance imports",
                    description: "Finance records will appear here once vault data is imported through the runtime."
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

    private func importRow(for entry: FinanceImportDTO) -> some View {
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

    private func accessibilityValue(for entry: FinanceImportDTO) -> String {
        [
            entry.importType.replacingOccurrences(of: "_", with: " ").capitalized,
            "Status \(entry.status.replacingOccurrences(of: "_", with: " "))",
            "Imported \(DateFormatting.formatAbsoluteTime(entry.importedAt))"
        ]
        .joined(separator: ", ")
    }
}
