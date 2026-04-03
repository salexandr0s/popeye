import SwiftUI
import PopeyeAPI

struct ControlChangesSection: View {
    let receipts: [MutationReceiptDTO]
    @State private var selectedReceipt: MutationReceiptDTO?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Recent Control Changes")
                .font(.headline)
                .foregroundStyle(.secondary)

            if receipts.isEmpty {
                ControlChangesEmptyState()
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(receipts) { receipt in
                        ControlChangeReceiptCard(receipt: receipt) {
                            selectedReceipt = receipt
                        }
                    }
                }
            }
        }
        .sheet(item: $selectedReceipt) { receipt in
            ControlChangeDetailSheet(receipt: receipt)
        }
    }
}
