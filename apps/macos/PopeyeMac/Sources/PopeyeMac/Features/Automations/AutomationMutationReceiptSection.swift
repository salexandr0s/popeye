import SwiftUI
import PopeyeAPI

struct AutomationMutationReceiptSection: View {
    let receipt: MutationReceiptDTO

    var body: some View {
        InspectorSection(title: "Latest Control Change") {
            DetailRow(label: "Summary", value: receipt.summary)
            DetailRow(label: "Status", value: receipt.status.replacingOccurrences(of: "_", with: " ").capitalized)
            DetailRow(label: "When", value: DateFormatting.formatAbsoluteTime(receipt.createdAt))
            Text(receipt.details)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}
