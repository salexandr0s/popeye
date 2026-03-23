import Foundation

public struct MemoryService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func search(query: String, limit: Int = 20, scope: String? = nil, types: String? = nil, domains: String? = nil) async throws -> MemorySearchResponseDTO {
        try await client.searchMemories(query: query, limit: limit, scope: scope, types: types, domains: domains)
    }

    public func listMemories() async throws -> [MemoryRecordDTO] {
        try await client.listMemories()
    }

    public func getMemory(id: String) async throws -> MemoryRecordDTO {
        try await client.getMemory(id: id)
    }

    public func getHistory(id: String) async throws -> MemoryHistoryDTO {
        try await client.getMemoryHistory(id: id)
    }

    public func audit() async throws -> MemoryAuditDTO {
        try await client.memoryAudit()
    }

    public func pin(id: String, targetKind: String, reason: String? = nil) async throws -> MemoryRecordDTO {
        try await client.pinMemory(id: id, targetKind: targetKind, reason: reason)
    }

    public func forget(id: String, reason: String? = nil) async throws -> MemoryRecordDTO {
        try await client.forgetMemory(id: id, reason: reason)
    }

    public func proposePromotion(id: String, targetPath: String) async throws -> MemoryPromotionProposalDTO {
        try await client.proposePromotion(id: id, targetPath: targetPath)
    }

    public func executePromotion(id: String, input: MemoryPromotionExecuteInput) async throws -> MemoryPromotionProposalDTO {
        try await client.executePromotion(id: id, input: input)
    }

    public func triggerMaintenance() async throws {
        _ = try await client.triggerMemoryMaintenance()
    }
}
