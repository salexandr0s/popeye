import Foundation

public struct SecurityAuditDTO: Codable, Sendable {
    public let findings: [SecurityAuditFindingDTO]
}

public struct SecurityAuditFindingDTO: Codable, Sendable, Identifiable {
    public var id: String { "\(code)-\(message)" }

    public let code: String
    public let severity: String  // "info" | "warn" | "error"
    public let message: String
    public let component: String?
    public let timestamp: String?
    public let details: [String: String]?
}
