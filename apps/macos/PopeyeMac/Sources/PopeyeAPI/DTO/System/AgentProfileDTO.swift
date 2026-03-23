import Foundation

public struct AgentProfileDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let description: String
    public let mode: String // restricted | interactive | elevated
    public let modelPolicy: String
    public let allowedRuntimeTools: [String]
    public let allowedCapabilityIds: [String]
    public let memoryScope: String
    public let recallScope: String
    public let filesystemPolicyClass: String
    public let contextReleasePolicy: String
    public let createdAt: String
    public let updatedAt: String?
}
