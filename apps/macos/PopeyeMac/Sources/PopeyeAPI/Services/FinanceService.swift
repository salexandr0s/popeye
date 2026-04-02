import Foundation

public struct FinanceService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadImports() async throws -> [FinanceImportDTO] {
        try await client.listFinanceImports()
    }

    public func loadVaults() async throws -> [VaultRecordDTO] {
        try await client.listVaults(domain: "finance")
    }

    public func openVault(id: String, requestedBy: String = "operator-ui") async throws -> VaultRecordDTO {
        let approval = try await client.createApproval(input: ApprovalRequestInput(
            scope: "vault_open",
            domain: "finance",
            riskClass: "ask",
            actionKind: "open",
            resourceScope: "resource",
            resourceType: "vault",
            resourceId: id,
            requestedBy: requestedBy,
            payloadPreview: "Open finance vault \(id)"
        ))
        let resolved = try await client.resolveApproval(id: approval.id, decision: "approved", reason: "Opened from the macOS client")
        return try await client.openVault(id: id, approvalId: resolved.id)
    }

    public func closeVault(id: String) async throws -> VaultRecordDTO {
        try await client.closeVault(id: id)
    }

    public func loadTransactions(importId: String? = nil, category: String? = nil, dateFrom: String? = nil, dateTo: String? = nil, limit: Int? = nil) async throws -> [FinanceTransactionDTO] {
        try await client.listFinanceTransactions(importId: importId, category: category, dateFrom: dateFrom, dateTo: dateTo, limit: limit)
    }

    public func loadDocuments(importId: String? = nil) async throws -> [FinanceDocumentDTO] {
        try await client.listFinanceDocuments(importId: importId)
    }

    public func search(query: String, category: String? = nil, dateFrom: String? = nil, dateTo: String? = nil, limit: Int = 20) async throws -> FinanceSearchResponseDTO {
        try await client.searchFinance(query: query, category: category, dateFrom: dateFrom, dateTo: dateTo, limit: limit)
    }

    public func loadDigest(period: String? = nil) async throws -> FinanceDigestDTO? {
        try await client.financeDigest(period: period)
    }

    public func triggerDigest(period: String? = nil) async throws -> FinanceDigestDTO {
        try await client.triggerFinanceDigest(period: period)
    }

    public func createImport(vaultId: String, importType: String = "csv", fileName: String) async throws -> FinanceImportDTO {
        try await client.createFinanceImport(input: FinanceImportCreateInput(vaultId: vaultId, importType: importType, fileName: fileName))
    }

    public func createTransaction(input: FinanceTransactionCreateInput) async throws -> FinanceTransactionDTO {
        try await client.createFinanceTransaction(input: input)
    }

    public func updateImportStatus(id: String, status: String, recordCount: Int? = nil) async throws {
        _ = try await client.updateFinanceImportStatus(id: id, input: FinanceImportStatusUpdateInput(status: status, recordCount: recordCount))
    }
}
