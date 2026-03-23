import Foundation

public struct MemoryRecordDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let description: String
    public let classification: String
    public let sourceType: String
    public let content: String
    public let confidence: Double
    public let scope: String
    public let workspaceId: String?
    public let projectId: String?
    public let sourceRunId: String?
    public let sourceTimestamp: String?
    public let memoryType: String // episodic | semantic | procedural
    public let dedupKey: String?
    public let lastReinforcedAt: String?
    public let archivedAt: String?
    public let createdAt: String
    public let durable: Bool
    public let domain: String
    public let contextReleasePolicy: String
}
