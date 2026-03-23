import Foundation
import PopeyeAPI

@Observable @MainActor
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

    var runs: [RunRecordDTO] = []
    var jobs: [JobRecordDTO] = []
    var tasks: [TaskRecordDTO] = []
    var interventions: [InterventionDTO] = []
    var usage: UsageSummaryDTO?
    var scheduler: SchedulerStatusDTO?
    var selectedItem: SelectedItem = .none
    var lastUpdated: Date?
    var isLoading = false

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let operationsService: OperationsService
    private let governanceService: GovernanceService
    private let systemService: SystemService
    private let client: ControlAPIClient
    private let pollIntervalSeconds: UInt64
    private var pollTask: Task<Void, Never>?

    init(client: ControlAPIClient, pollIntervalSeconds: Int = 10) {
        self.client = client
        self.pollIntervalSeconds = UInt64(pollIntervalSeconds)
        self.operationsService = OperationsService(client: client)
        self.governanceService = GovernanceService(client: client)
        self.systemService = SystemService(client: client)
    }

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
        isLoading = true
        do {
            async let r = operationsService.loadRuns()
            async let j = operationsService.loadJobs()
            async let t = operationsService.loadTasks()
            async let i = governanceService.loadInterventions()
            async let u = systemService.loadDashboardSnapshot()

            runs = try await r
            jobs = try await j
            tasks = try await t
            interventions = try await i
            let snap = try await u
            usage = snap.usage
            scheduler = snap.scheduler
            lastUpdated = .now
        } catch {
            PopeyeLogger.refresh.error("Command center load failed: \(error)")
        }
        isLoading = false
    }

    func startPolling() {
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

    // MARK: - Mutations

    func retryRun(id: String) async {
        await mutations.execute(
            action: { [client] in _ = try await client.retryRun(id: id) },
            successMessage: "Run retry initiated", fallbackError: "Retry failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func cancelRun(id: String) async {
        await mutations.execute(
            action: { [client] in _ = try await client.cancelRun(id: id) },
            successMessage: "Run cancelled", fallbackError: "Cancel failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func pauseJob(id: String) async {
        await mutations.execute(
            action: { [client] in _ = try await client.pauseJob(id: id) },
            successMessage: "Job paused", fallbackError: "Pause failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func resumeJob(id: String) async {
        await mutations.execute(
            action: { [client] in _ = try await client.resumeJob(id: id) },
            successMessage: "Job resumed", fallbackError: "Resume failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func enqueueJob(id: String) async {
        await mutations.execute(
            action: { [client] in _ = try await client.enqueueJob(id: id) },
            successMessage: "Job enqueued", fallbackError: "Enqueue failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func resolveIntervention(id: String, note: String? = nil) async {
        await mutations.execute(
            action: { [client] in _ = try await client.resolveIntervention(id: id, note: note) },
            successMessage: "Intervention resolved", fallbackError: "Resolve failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func dismissMutation() { mutations.dismiss() }
}
