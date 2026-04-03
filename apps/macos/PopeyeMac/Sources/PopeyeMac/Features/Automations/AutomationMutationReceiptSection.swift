import SwiftUI
import PopeyeAPI

struct AutomationMutationReceiptSection: View {
    let receipt: MutationReceiptDTO?
    let phase: ScreenOperationPhase
    let retryLoad: (() -> Void)?

    var body: some View {
        InspectorSection(title: "Latest Control Change") {
            VStack(alignment: .leading, spacing: 12) {
                if phase != .idle {
                    OperationStatusView(
                        phase: phase,
                        loadingTitle: "Loading control receipts…",
                        failureTitle: "Latest control change unavailable",
                        retryAction: retryLoad
                    )
                }

                if let receipt {
                    DetailRow(label: "Summary", value: receipt.summary)
                    DetailRow(label: "Status", value: receipt.status.replacing("_", with: " ").capitalized)
                    DetailRow(label: "When", value: DateFormatting.formatAbsoluteTime(receipt.createdAt))
                    Text(receipt.details)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                } else if phase == .idle {
                    Text("No control changes recorded yet.")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
