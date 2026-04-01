import Foundation

public struct AppliedPlaybookDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let scope: String
    public let revisionHash: String
}
