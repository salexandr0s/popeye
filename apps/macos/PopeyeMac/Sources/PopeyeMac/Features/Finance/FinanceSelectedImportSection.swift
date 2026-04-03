import SwiftUI
import PopeyeAPI

struct FinanceSelectedImportSection: View {
    let activeImport: FinanceImportDTO?
    let isMutating: Bool
    let updateStatus: (String) -> Void

    var body: some View {
        InspectorSection(title: "Selected Import") {
            if let activeImport {
                DetailRow(label: "File", value: activeImport.fileName)
                DetailRow(
                    label: "Type",
                    value: activeImport.importType.replacingOccurrences(of: "_", with: " ").capitalized
                )
                DetailRow(label: "Status", value: activeImport.status.capitalized)
                DetailRow(label: "Records", value: "\(activeImport.recordCount)")
                ImportStatusActionRow(
                    selectedStatus: activeImport.status,
                    isDisabled: isMutating,
                    updateStatus: updateStatus
                )
            } else {
                Text("Create or select an import to manage its status.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
