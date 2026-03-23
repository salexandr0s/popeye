import Foundation

public struct MemoryHistoryDTO: Codable, Sendable {
    public let memoryId: String
    public let versionChain: [MemoryVersionDTO]
    public let evidenceLinks: [MemoryEvidenceLinkDTO]
    public let operatorActions: [MemoryOperatorActionDTO]
}

public struct MemoryVersionDTO: Codable, Sendable, Identifiable {
    public var id: String { factId }
    public let factId: String
    public let text: String
    public let createdAt: String
    public let isLatest: Bool
    public let relation: String?
}

public struct MemoryEvidenceLinkDTO: Codable, Sendable, Identifiable {
    public var id: String { artifactId }
    public let artifactId: String
    public let excerpt: String?
    public let createdAt: String
}

public struct MemoryOperatorActionDTO: Codable, Sendable, Identifiable {
    public var id: String { "\(actionKind)-\(createdAt)" }
    public let actionKind: String
    public let reason: String
    public let createdAt: String
}
