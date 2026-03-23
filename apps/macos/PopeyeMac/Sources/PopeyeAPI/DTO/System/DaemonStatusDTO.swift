import Foundation

public struct DaemonStatusDTO: Codable, Sendable {
    public let ok: Bool
    public let runningJobs: Int
    public let queuedJobs: Int
    public let openInterventions: Int
    public let activeLeases: Int
    public let engineKind: String
    public let schedulerRunning: Bool
    public let startedAt: String
    public let lastShutdownAt: String?
}
