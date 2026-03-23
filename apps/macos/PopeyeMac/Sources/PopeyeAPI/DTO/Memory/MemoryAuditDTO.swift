import Foundation

public struct MemoryAuditDTO: Codable, Sendable {
    public let totalMemories: Int
    public let activeMemories: Int
    public let archivedMemories: Int
    public let byType: [String: Int]
    public let byScope: [String: Int]
    public let byClassification: [String: Int]
    public let averageConfidence: Double
    public let staleCount: Int
    public let consolidationsPerformed: Int
    public let lastDecayRunAt: String?
    public let lastConsolidationRunAt: String?
    public let lastDailySummaryAt: String?
}
