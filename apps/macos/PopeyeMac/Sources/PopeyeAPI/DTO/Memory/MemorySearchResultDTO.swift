import Foundation

public struct MemorySearchResponseDTO: Codable, Sendable {
    public let results: [MemorySearchHitDTO]
    public let query: String
    public let totalCandidates: Int
    public let latencyMs: Double
    public let searchMode: String // hybrid | fts_only | vec_only
    public let strategy: String?
    public let traceId: String?
}

public struct MemorySearchHitDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let description: String
    public let content: String?
    public let type: String
    public let confidence: Double
    public let effectiveConfidence: Double
    public let scope: String
    public let workspaceId: String?
    public let projectId: String?
    public let sourceType: String
    public let createdAt: String
    public let lastReinforcedAt: String?
    public let score: Double
    public let layer: String?
    public let domain: String?
    public let scoreBreakdown: ScoreBreakdownDTO
}

public struct ScoreBreakdownDTO: Codable, Sendable {
    public let relevance: Double
    public let recency: Double
    public let confidence: Double
    public let scopeMatch: Double
    public let temporalFit: Double?
    public let sourceTrust: Double?
    public let salience: Double?
    public let latestness: Double?
    public let evidenceDensity: Double?
    public let operatorBonus: Double?
    public let layerPrior: Double?
}
