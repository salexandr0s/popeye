import Foundation

public struct VaultRecordDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let domain: String
    public let kind: String
    public let dbPath: String
    public let encrypted: Bool
    public let encryptionKeyRef: String?
    public let status: String
    public let createdAt: String
    public let lastAccessedAt: String?
}
