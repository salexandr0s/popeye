import Foundation

public struct InstructionPreviewDTO: Codable, Sendable {
    public let id: String
    public let sources: [InstructionSourceDTO]
    public let compiledText: String
    public let bundleHash: String
    public let warnings: [String]
    public let createdAt: String
}

public struct InstructionSourceDTO: Codable, Sendable, Identifiable {
    public var id: String { "\(type)-\(precedence)" }
    public let precedence: Int
    public let type: String // pi_base | popeye_base | workspace | project | identity | ...
    public let path: String?
    public let inlineId: String?
    public let contentHash: String
    public let content: String
}
