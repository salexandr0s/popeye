import Foundation

public struct InterventionDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let code: String // needs_credentials|needs_policy_decision|...|failed_final
    public let runId: String?
    public let status: String // open|resolved
    public let reason: String
    public let createdAt: String
    public let resolvedAt: String?
    public let updatedAt: String?
    public let resolutionNote: String?
}
