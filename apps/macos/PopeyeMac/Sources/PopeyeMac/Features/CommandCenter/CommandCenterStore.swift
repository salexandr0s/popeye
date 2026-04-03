import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class CommandCenterStore {
    static let idleHintMs: Double = 600_000
    static let stuckRiskMs: Double = 1_800_000
    static let panelStaleMs: Double = 20_000

    enum SelectedItem: Equatable {
        case none
        case run(String)
        case job(String)
        case intervention(String)
    }

    struct Dependencies: Sendable {
        var loadRuns: @Sendable () async throws -> [RunRecordDTO]
        var loadJobs: @Sendable () async throws -> [JobRecordDTO]
        var loadTasks: @Sendable () async throws -> [TaskRecordDTO]
        var loadInterventions: @Sendable () async throws -> [InterventionDTO]
        var loadDashboardSnapshot: @Sendable () async throws -> DashboardSnapshot
        var retryRun: @Sendable (_ id: String) async throws -> Void
        var cancelRun: @Sendable (_ id: String) async throws -> Void
        var pauseJob: @Sendable (_ id: String) async throws -> Void
        var resumeJob: @Sendable (_ id: String) async throws -> Void
        var enqueueJob: @Sendable (_ id: String) async throws -> Void
        var resolveIntervention: @Sendable (_ id: String, _ note: String?) async throws -> Void

        static func live(client: ControlAPIClient) -> Dependencies {
            let operationsService = OperationsService(client: client)
            let governanceService = GovernanceService(client: client)
            let systemService = SystemService(client: client)
            return Dependencies(
                loadRuns: { try await operationsService.loadRuns() },
                loadJobs: { try await operationsService.loadJobs() },
                loadTasks: { try await operationsService.loadTasks() },
                loadInterventions: { try await governanceService.loadInterventions() },
                loadDashboardSnapshot: { try await systemService.loadDashboardSnapshot() },
                retryRun: { id in _ = try await client.retryRun(id: id) },
                cancelRun: { id in _ = try await client.cancelRun(id: id) },
                pauseJob: { id in _ = try await client.pauseJob(id: id) },
                resumeJob: { id in _ = try await client.resumeJob(id: id) },
                enqueueJob: { id in _ = try await client.enqueueJob(id: id) },
                resolveIntervention: { id, note in _ = try await client.resolveIntervention(id: id, note: note) }
            )
        }
    }

    var runs: [RunRecordDTO] = []
    var jobs: [JobRecordDTO] = []
    var tasks: [TaskRecordDTO] = []
    var interventions: [InterventionDTO] = []
    var usage: UsageSummaryDTO?
    var scheduler: SchedulerStatusDTO?
    var selectedItem: SelectedItem = .none
    var lastUpdated: Date?
    var loadPhase: ScreenLoadPhase = .idle
    var refreshPhase: ScreenOperationPhase = .idle

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let dependencies: Dependencies
    private let pollIntervalSeconds: UInt64
    private let pollingEnabled: Bool
    private var pollTask: Task<Void, Never>?

    init(client: ControlAPIClient, pollIntervalSeconds: Int = 10, pollingEnabled: Bool = true) {
        self.dependencies = .live(client: client)
        self.pollIntervalSeconds = UInt64(pollIntervalSeconds)
        self.pollingEnabled = pollingEnabled
    }

    init(dependencies: Dependencies, pollIntervalSeconds: Int = 10, pollingEnabled: Bool = true) {
        self.dependencies = dependencies
        self.pollIntervalSeconds = UInt64(pollIntervalSeconds)
        self.pollingEnabled = pollingEnabled
    }

    var error: APIError? { loadPhase.error }
    var refreshError: APIError? { refreshPhase.error }
    var isMutating: Bool { mutationState == .executing }

    var activeRuns: [RunRecordDTO] {
        runs.filter { ["starting", "running"].contains($0.state) }
            .sorted { $0.startedAt > $1.startedAt }
    }

    var nonTerminalJobs: [JobRecordDTO] {
        jobs.filter { !["succeeded", "failed_final", "cancelled"].contains($0.status) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    var blockedJobs: [JobRecordDTO] {
        jobs.filter { $0.status == "blocked_operator" }
    }

    var openInterventions: [InterventionDTO] {
        interventions.filter { $0.status == "open" }
    }

    var recentFailures: [RunRecordDTO] {
        runs.filter { ["failed_retryable", "failed_final"].contains($0.state) }
            .sorted { $0.finishedAt ?? $0.startedAt > $1.finishedAt ?? $1.startedAt }
            .prefix(5).map { $0 }
    }

    struct AttentionItem: Identifiable {
        enum Kind { case idle, stuckRisk, blocked, intervention, failure }
        let id: String
        let kind: Kind
        let title: String
        let detail: String
    }

    var attentionItems: [AttentionItem] {
        var items: [AttentionItem] = []
        let now = Date.now

        for run in activeRuns {
            guard let started = DateFormatting.parseISO8601(run.startedAt) else { continue }
            let elapsed = now.timeIntervalSince(started) * 1000
            if elapsed > Self.stuckRiskMs {
                items.append(.init(id: "stuck-\(run.id)", kind: .stuckRisk,
                    title: "Stuck risk", detail: taskTitle(for: run.taskId)))
            } else if elapsed > Self.idleHintMs {
                items.append(.init(id: "idle-\(run.id)", kind: .idle,
                    title: "Idle hint", detail: taskTitle(for: run.taskId)))
            }
        }

        for job in blockedJobs {
            items.append(.init(id: "blocked-\(job.id)", kind: .blocked,
                title: "Blocked job", detail: taskTitle(for: job.taskId)))
        }

        for intv in openInterventions {
            items.append(.init(id: "intv-\(intv.id)", kind: .intervention,
                title: intv.code.replacing("_", with: " ").capitalized,
                detail: intv.reason))
        }

        for run in recentFailures.prefix(3) {
            items.append(.init(id: "fail-\(run.id)", kind: .failure,
                title: "Failed", detail: run.error ?? taskTitle(for: run.taskId)))
        }

        return items
    }

    func taskTitle(for taskId: String) -> String {
        tasks.first { $0.id == taskId }?.title ?? IdentifierFormatting.formatShortID(taskId)
    }

    func load() async {
        let isRefreshingExistingData = lastUpdated != nil
        if isRefreshingExistingData {
            refreshPhase = .loading
        } else {
            loadPhase = .loading
        }

        do {
            async let runsTask = dependencies.loadRuns()
            async let jobsTask = dependencies.loadJobs()
            async let tasksTask = dependencies.loadTasks()
            async let interventionsTask = dependencies.loadInterventions()
            async let snapshotTask = dependencies.loadDashboardSnapshot()

            runs = try await runsTask
            jobs = try await jobsTask
            tasks = try await tasksTask
            interventions = try await interventionsTask
            let snapshot = try await snapshotTask
            usage = snapshot.usage
            scheduler = snapshot.scheduler
            lastUpdated = .now
            loadPhase = .loaded
            refreshPhase = .idle
        } catch {
            let apiError = APIError.from(error)
            if isRefreshingExistingData {
                refreshPhase = .failed(apiError)
            } else {
                loadPhase = .failed(apiError)
            }
        }
    }

    func startPolling() {
        guard pollingEnabled else { return }
        stopPolling()
        let interval = pollIntervalSeconds
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(interval))
                guard !Task.isCancelled else { break }
                await self?.load()
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func retryRun(id: String) async {
        await mutations.execute(
            action: { [dependencies] in try await dependencies.retryRun(id) },
            successMessage: "Run retry initiated",
            fallbackError: "Retry failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func cancelRun(id: String) async {
        await mutations.execute(
            action: { [dependencies] in try await dependencies.cancelRun(id) },
            successMessage: "Run cancelled",
            fallbackError: "Cancel failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func pauseJob(id: String) async {
        await mutations.execute(
            action: { [dependencies] in try await dependencies.pauseJob(id) },
            successMessage: "Job paused",
            fallbackError: "Pause failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func resumeJob(id: String) async {
        await mutations.execute(
            action: { [dependencies] in try await dependencies.resumeJob(id) },
            successMessage: "Job resumed",
            fallbackError: "Resume failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func enqueueJob(id: String) async {
        await mutations.execute(
            action: { [dependencies] in try await dependencies.enqueueJob(id) },
            successMessage: "Job enqueued",
            fallbackError: "Enqueue failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func resolveIntervention(id: String, note: String? = nil) async {
        await mutations.execute(
            action: { [dependencies] in try await dependencies.resolveIntervention(id, note) },
            successMessage: "Intervention resolved",
            fallbackError: "Resolve failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func dismissMutation() {
        mutations.dismiss()
    }
}
