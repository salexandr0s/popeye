import Foundation

public struct HealthDTO: Codable, Sendable, Identifiable {
    public var id: String { startedAt }

    public let ok: Bool
    public let startedAt: String
}
