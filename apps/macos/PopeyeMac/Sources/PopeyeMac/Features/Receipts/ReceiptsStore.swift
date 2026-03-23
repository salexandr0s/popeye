import Foundation
import PopeyeAPI

@Observable @MainActor
final class ReceiptsStore {
    var receipts: [ReceiptRecordDTO] = []
    var selectedReceiptId: String?
    var selectedReceipt: ReceiptRecordDTO?
    var isLoading = false
    var isLoadingDetail = false
    var searchText = ""
    var statusFilter: String?
    var sortOrder: [KeyPathComparator<ReceiptRecordDTO>] = [
        .init(\.createdAt, order: .reverse)
    ]

    var filteredReceipts: [ReceiptRecordDTO] {
        var result = receipts
        if let filter = statusFilter {
            result = result.filter { $0.status == filter }
        }
        if !searchText.isEmpty {
            result = result.filter {
                $0.id.localizedStandardContains(searchText)
                || $0.summary.localizedStandardContains(searchText)
                || $0.runId.localizedStandardContains(searchText)
                || $0.status.localizedStandardContains(searchText)
            }
        }
        return result
    }

    var availableStatuses: [String] {
        Array(Set(receipts.map(\.status))).sorted()
    }

    private let operationsService: OperationsService

    init(client: ControlAPIClient) {
        self.operationsService = OperationsService(client: client)
    }

    func load() async {
        isLoading = true
        do {
            receipts = try await operationsService.loadReceipts()
            sort(by: sortOrder)
        } catch {
            PopeyeLogger.refresh.error("Receipts load failed: \(error)")
        }
        isLoading = false
    }

    func loadDetail(id: String) async {
        isLoadingDetail = true
        do {
            selectedReceipt = try await operationsService.loadReceiptDetail(id: id)
        } catch {
            PopeyeLogger.refresh.error("Receipt detail load failed: \(error)")
            selectedReceipt = nil
        }
        isLoadingDetail = false
    }

    func sort(by newOrder: [KeyPathComparator<ReceiptRecordDTO>]) {
        sortOrder = newOrder
        receipts.sort(using: newOrder)
    }
}
