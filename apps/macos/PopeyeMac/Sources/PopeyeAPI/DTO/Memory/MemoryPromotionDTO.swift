import Foundation

public struct MemoryPromotionProposalDTO: Codable, Sendable {
    public let memoryId: String
    public let targetPath: String
    public let diff: String
    public let approved: Bool
    public let promoted: Bool
}
