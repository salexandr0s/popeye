import Foundation
import Testing
@testable import PopeyeAPI
@testable import PopeyeMac

@Suite("Scheduler Job Buckets")
struct SchedulerJobBucketsTests {
    private let decoder = ResponseDecoder.makeDecoder()

    @Test("In-flight jobs include only active states and sort newest first")
    func inFlightJobs() throws {
        let jobs = try decodeJobs(
            """
            [
              {
                "id": "job-queued",
                "taskId": "task-queued",
                "workspaceId": "default",
                "status": "queued",
                "retryCount": 0,
                "availableAt": "2026-04-02T08:00:00Z",
                "lastRunId": null,
                "createdAt": "2026-04-02T08:00:00Z",
                "updatedAt": "2026-04-02T08:05:00Z"
              },
              {
                "id": "job-running",
                "taskId": "task-running",
                "workspaceId": "default",
                "status": "running",
                "retryCount": 1,
                "availableAt": "2026-04-02T08:00:00Z",
                "lastRunId": null,
                "createdAt": "2026-04-02T08:00:00Z",
                "updatedAt": "2026-04-02T08:10:00Z"
              },
              {
                "id": "job-succeeded",
                "taskId": "task-succeeded",
                "workspaceId": "default",
                "status": "succeeded",
                "retryCount": 0,
                "availableAt": "2026-04-02T08:00:00Z",
                "lastRunId": null,
                "createdAt": "2026-04-02T08:00:00Z",
                "updatedAt": "2026-04-02T08:15:00Z"
              }
            ]
            """
        )

        let result = SchedulerJobBuckets.inFlightJobs(from: jobs)
        #expect(result.map(\.id) == ["job-running", "job-queued"])
    }

    @Test("Recent completions include only terminal states and honor limit")
    func recentCompletions() throws {
        let jobs = try decodeJobs(
            """
            [
              {
                "id": "job-succeeded",
                "taskId": "task-succeeded",
                "workspaceId": "default",
                "status": "succeeded",
                "retryCount": 0,
                "availableAt": "2026-04-02T08:00:00Z",
                "lastRunId": null,
                "createdAt": "2026-04-02T08:00:00Z",
                "updatedAt": "2026-04-02T08:15:00Z"
              },
              {
                "id": "job-failed",
                "taskId": "task-failed",
                "workspaceId": "default",
                "status": "failed_final",
                "retryCount": 2,
                "availableAt": "2026-04-02T08:00:00Z",
                "lastRunId": null,
                "createdAt": "2026-04-02T08:00:00Z",
                "updatedAt": "2026-04-02T08:20:00Z"
              },
              {
                "id": "job-cancelled",
                "taskId": "task-cancelled",
                "workspaceId": "default",
                "status": "cancelled",
                "retryCount": 0,
                "availableAt": "2026-04-02T08:00:00Z",
                "lastRunId": null,
                "createdAt": "2026-04-02T08:00:00Z",
                "updatedAt": "2026-04-02T08:10:00Z"
              },
              {
                "id": "job-running",
                "taskId": "task-running",
                "workspaceId": "default",
                "status": "running",
                "retryCount": 0,
                "availableAt": "2026-04-02T08:00:00Z",
                "lastRunId": null,
                "createdAt": "2026-04-02T08:00:00Z",
                "updatedAt": "2026-04-02T08:25:00Z"
              }
            ]
            """
        )

        let result = SchedulerJobBuckets.recentCompletions(from: jobs, limit: 2)
        #expect(result.map(\.id) == ["job-failed", "job-succeeded"])
    }

    private func decodeJobs(_ json: String) throws -> [JobRecordDTO] {
        try decoder.decode([JobRecordDTO].self, from: Data(json.utf8))
    }
}
