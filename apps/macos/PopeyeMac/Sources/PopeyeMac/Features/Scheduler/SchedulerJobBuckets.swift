import Foundation
import PopeyeAPI

enum SchedulerJobBuckets {
    private static let activeStates: Set<String> = [
        "queued", "leased", "running", "waiting_retry", "paused", "blocked_operator",
    ]
    private static let terminalStates: Set<String> = [
        "succeeded", "failed_final", "cancelled",
    ]

    static func inFlightJobs(from jobs: [JobRecordDTO]) -> [JobRecordDTO] {
        jobs
            .filter { activeStates.contains($0.status) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    static func recentCompletions(from jobs: [JobRecordDTO], limit: Int = 10) -> [JobRecordDTO] {
        Array(
            jobs
                .filter { terminalStates.contains($0.status) }
                .sorted { $0.updatedAt > $1.updatedAt }
                .prefix(limit)
        )
    }
}
