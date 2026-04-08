import SwiftUI
import PopeyeAPI

struct TodoAccountOperationsSection: View {
    let syncResult: TodoSyncResultDTO?
    let reconcileResult: TodoReconcileResultDTO?

    var body: some View {
        InspectorSection(title: "Account Operations") {
            if let syncResult {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Last sync")
                        .font(.subheadline.weight(.semibold))
                    DetailRow(label: "Synced", value: "\(syncResult.todosSynced)")
                    DetailRow(label: "Updated", value: "\(syncResult.todosUpdated)")
                    if syncResult.errors.isEmpty == false {
                        DetailRow(label: "Errors", value: syncResult.errors.joined(separator: "\n"))
                    }
                }
            }

            if let reconcileResult {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Last reconcile")
                        .font(.subheadline.weight(.semibold))
                    DetailRow(label: "Added", value: "\(reconcileResult.added)")
                    DetailRow(label: "Updated", value: "\(reconcileResult.updated)")
                    DetailRow(label: "Removed", value: "\(reconcileResult.removed)")
                    if reconcileResult.errors.isEmpty == false {
                        DetailRow(label: "Errors", value: reconcileResult.errors.joined(separator: "\n"))
                    }
                }
            }

            if syncResult == nil && reconcileResult == nil {
                Text("Sync or reconcile the selected account to review the latest operation results here.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
