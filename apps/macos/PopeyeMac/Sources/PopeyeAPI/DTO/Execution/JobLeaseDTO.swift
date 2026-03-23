import Foundation

public struct JobLeaseDTO: Codable, Sendable {
    public let jobId: String
    public let leaseOwner: String
    public let leaseExpiresAt: String
    public let updatedAt: String
}
