import Foundation
import PopeyeAPI

@Observable @MainActor
final class JobsStore {
    var jobs: [JobRecordDTO] = []
    var tasks: [TaskRecordDTO] = []
    var selectedJobId: String?
    var selectedJobDetail: JobDetailSnapshot?
    var isLoading = false
    var isLoadingDetail = false
    var searchText = ""
    var statusFilter: String?
    var sortOrder: [KeyPathComparator<JobRecordDTO>] = [
        .init(\.updatedAt, order: .reverse)
    ]

    var filteredJobs: [JobRecordDTO] {
        var result = jobs
        if let filter = statusFilter {
            result = result.filter { $0.status == filter }
        }
        if !searchText.isEmpty {
            result = result.filter {
                $0.id.localizedStandardContains(searchText)
                || taskTitle(for: $0.taskId).localizedStandardContains(searchText)
                || $0.status.localizedStandardContains(searchText)
            }
        }
        return result
    }

    var availableStatuses: [String] {
        Array(Set(jobs.map(\.status))).sorted()
    }

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let operationsService: OperationsService
    private let client: ControlAPIClient

    init(client: ControlAPIClient) {
        self.client = client
        self.operationsService = OperationsService(client: client)
    }

    func taskTitle(for taskId: String) -> String {
        tasks.first { $0.id == taskId }?.title ?? IdentifierFormatting.formatShortID(taskId)
    }

    func load() async {
        isLoading = true
        do {
            async let j = operationsService.loadJobs()
            async let t = operationsService.loadTasks()
            jobs = try await j
            tasks = try await t
            sort(by: sortOrder)
        } catch {
            PopeyeLogger.refresh.error("Jobs load failed: \(error)")
        }
        isLoading = false
    }

    func loadDetail(id: String) async {
        isLoadingDetail = true
        do {
            selectedJobDetail = try await operationsService.loadJobDetail(id: id)
        } catch {
            PopeyeLogger.refresh.error("Job detail load failed: \(error)")
            selectedJobDetail = nil
        }
        isLoadingDetail = false
    }

    func sort(by newOrder: [KeyPathComparator<JobRecordDTO>]) {
        sortOrder = newOrder
        jobs.sort(using: newOrder)
    }

    // MARK: - Mutations

    func pauseJob(id: String) async {
        await mutations.execute(
            action: { [client] in _ = try await client.pauseJob(id: id) },
            successMessage: "Job paused",
            fallbackError: "Pause failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func resumeJob(id: String) async {
        await mutations.execute(
            action: { [client] in _ = try await client.resumeJob(id: id) },
            successMessage: "Job resumed",
            fallbackError: "Resume failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func enqueueJob(id: String) async {
        await mutations.execute(
            action: { [client] in _ = try await client.enqueueJob(id: id) },
            successMessage: "Job enqueued",
            fallbackError: "Enqueue failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func dismissMutation() { mutations.dismiss() }

    static func canPause(status: String) -> Bool {
        MutationEligibility.canPauseJob(status: status)
    }

    static func canResume(status: String) -> Bool {
        MutationEligibility.canResumeJob(status: status)
    }

    static func canEnqueue(status: String) -> Bool {
        MutationEligibility.canEnqueueJob(status: status)
    }
}
