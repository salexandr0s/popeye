import Foundation
import PopeyeAPI

@Observable @MainActor
final class RunsStore {
    var runs: [RunRecordDTO] = []
    var tasks: [TaskRecordDTO] = []
    var selectedRunId: String?
    var selectedRunDetail: RunDetailSnapshot?
    var isLoading = false
    var isLoadingDetail = false
    var searchText = ""
    var stateFilter: String?
    var sortOrder: [KeyPathComparator<RunRecordDTO>] = [
        .init(\.startedAt, order: .reverse)
    ]

    var filteredRuns: [RunRecordDTO] {
        var result = runs
        if let filter = stateFilter {
            result = result.filter { $0.state == filter }
        }
        if !searchText.isEmpty {
            result = result.filter {
                $0.id.localizedStandardContains(searchText)
                || taskTitle(for: $0.taskId).localizedStandardContains(searchText)
                || $0.state.localizedStandardContains(searchText)
                || ($0.error?.localizedStandardContains(searchText) ?? false)
            }
        }
        return result
    }

    var availableStates: [String] {
        Array(Set(runs.map(\.state))).sorted()
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
            async let r = operationsService.loadRuns()
            async let t = operationsService.loadTasks()
            runs = try await r
            tasks = try await t
            sort(by: sortOrder)
        } catch {
            PopeyeLogger.refresh.error("Runs load failed: \(error)")
        }
        isLoading = false
    }

    func loadDetail(id: String) async {
        isLoadingDetail = true
        do {
            selectedRunDetail = try await operationsService.loadRunDetail(id: id)
        } catch {
            PopeyeLogger.refresh.error("Run detail load failed: \(error)")
            selectedRunDetail = nil
        }
        isLoadingDetail = false
    }

    func sort(by newOrder: [KeyPathComparator<RunRecordDTO>]) {
        sortOrder = newOrder
        runs.sort(using: newOrder)
    }

    // MARK: - Mutations

    func retryRun(id: String) async {
        await mutations.execute(
            action: { [client] in _ = try await client.retryRun(id: id) },
            successMessage: "Run retry initiated",
            fallbackError: "Retry failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func cancelRun(id: String) async {
        await mutations.execute(
            action: { [client] in _ = try await client.cancelRun(id: id) },
            successMessage: "Run cancelled",
            fallbackError: "Cancel failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func dismissMutation() { mutations.dismiss() }

    static func canRetry(state: String) -> Bool {
        MutationEligibility.canRetryRun(state: state)
    }

    static func canCancel(state: String) -> Bool {
        MutationEligibility.canCancelRun(state: state)
    }
}
