import Foundation

public struct SchedulerStatusDTO: Codable, Sendable {
    public let running: Bool
    public let activeLeases: Int
    public let activeRuns: Int
    public let nextHeartbeatDueAt: String?
}
