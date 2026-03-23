import SwiftUI
import PopeyeAPI

struct ReceiptsTableView: View {
    @Bindable var store: ReceiptsStore

    var body: some View {
        Table(store.filteredReceipts, selection: $store.selectedReceiptId, sortOrder: $store.sortOrder) {
            TableColumn("Status", value: \.status) { receipt in
                StatusBadge(state: receipt.status)
            }
            .width(min: 80, ideal: 110)

            TableColumn("Summary", value: \.summary) { receipt in
                Text(receipt.summary)
                    .lineLimit(2)
                    .truncationMode(.tail)
            }

            TableColumn("Tokens In") { receipt in
                Text(IdentifierFormatting.formatTokenCount(receipt.usage.tokensIn))
                    .font(.callout)
                    .monospacedDigit()
            }
            .width(min: 70, ideal: 90)

            TableColumn("Tokens Out") { receipt in
                Text(IdentifierFormatting.formatTokenCount(receipt.usage.tokensOut))
                    .font(.callout)
                    .monospacedDigit()
            }
            .width(min: 70, ideal: 90)

            TableColumn("Created", value: \.createdAt) { receipt in
                Text(DateFormatting.formatRelativeTime(receipt.createdAt))
                    .font(.caption)
            }
            .width(min: 70, ideal: 90)
        }
        .contextMenu(forSelectionType: ReceiptRecordDTO.ID.self) { ids in
            if let id = ids.first, let receipt = store.receipts.first(where: { $0.id == id }) {
                Button("Copy Receipt ID") { Clipboard.copy(receipt.id) }
                Button("Copy Run ID") { Clipboard.copy(receipt.runId) }
                Button("Copy Summary") { Clipboard.copy(receipt.summary) }
            }
        }
        .onChange(of: store.sortOrder) { _, newOrder in
            store.sort(by: newOrder)
        }
        .onChange(of: store.selectedReceiptId) { _, newId in
            handleSelectionChange(newId)
        }
    }

    private func handleSelectionChange(_ newId: String?) {
        guard let id = newId else {
            store.selectedReceipt = nil
            return
        }
        Task { await store.loadDetail(id: id) }
    }
}
