import Foundation
import Testing
@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("Memory Store")
struct MemoryStoreRolloutTests {
    @Test("Load transitions to empty when no memories are returned")
    func loadEmpty() async {
        let store = MemoryStore(dependencies: .stub(listMemories: { _, _ in [] }))

        await store.loadList()

        #expect(store.loadPhase == .empty)
        #expect(store.memories.isEmpty)
    }

    @Test("Search failure preserves results and surfaces a recoverable error")
    func searchFailurePreservesResults() async {
        let store = MemoryStore(dependencies: .stub(searchMemories: { _, _, _ in throw APIError.forbidden }))
        store.searchText = "daily review"
        store.searchResults = FeaturePreviewFixtures.memorySearchResponse(query: store.searchText, results: FeaturePreviewFixtures.memorySearchHits)

        await store.search()

        #expect(store.searchResults?.results.count == 1)
        #expect(store.searchPhase == .failed(.forbidden))
    }

    @Test("Detail failure preserves existing content")
    func detailFailurePreservesContent() async {
        let store = MemoryStore(dependencies: .stub(loadMemoryDetail: { _ in throw APIError.notFound }))
        store.selectedDetail = FeaturePreviewFixtures.memoryRecord

        await store.loadDetail(id: FeaturePreviewFixtures.memoryRecord.id)

        #expect(store.selectedDetail?.id == FeaturePreviewFixtures.memoryRecord.id)
        #expect(store.detailPhase == .failed(.notFound))
    }

    @Test("History failure preserves existing history")
    func historyFailurePreservesContent() async {
        let store = MemoryStore(dependencies: .stub(loadMemoryHistory: { _ in throw APIError.notFound }))
        store.selectedMemoryId = FeaturePreviewFixtures.memoryRecord.id
        store.memoryHistory = FeaturePreviewFixtures.memoryHistory

        await store.loadHistory(id: FeaturePreviewFixtures.memoryRecord.id)

        #expect(store.memoryHistory?.memoryId == FeaturePreviewFixtures.memoryHistory.memoryId)
        #expect(store.historyPhase == .failed(.notFound))
    }

    @Test("Pin success reports through shared mutation state")
    func pinSuccess() async {
        let store = MemoryStore(dependencies: .stub(
            listMemories: { _, _ in FeaturePreviewFixtures.memoryRecords },
            loadMemoryDetail: { _ in FeaturePreviewFixtures.memoryRecord },
            loadMemoryHistory: { _ in FeaturePreviewFixtures.memoryHistory }
        ))
        store.selectedMemoryId = FeaturePreviewFixtures.memoryRecord.id

        await store.pinMemory(id: FeaturePreviewFixtures.memoryRecord.id, targetKind: "fact")

        #expect(store.mutationState == .succeeded("Memory pinned"))
        #expect(store.loadPhase == .loaded)
        #expect(store.detailPhase == .idle)
        #expect(store.historyPhase == .idle)
    }
}

@MainActor
@Suite("Automation Store")
struct AutomationStoreRolloutTests {
    @Test("Root load failure surfaces a failed root phase")
    func loadFailure() async {
        let store = AutomationStore(dependencies: .stub(loadAutomations: { _ in throw APIError.transportUnavailable }))

        await store.load()

        #expect(store.loadPhase == .failed(.transportUnavailable))
    }

    @Test("Receipt failure keeps automation content visible")
    func receiptsFailureDoesNotFailScreen() async {
        let store = AutomationStore(dependencies: .stub(
            loadMutationReceipts: { _, _ in throw APIError.forbidden }
        ))

        await store.load()

        #expect(store.loadPhase == .loaded)
        #expect(store.automations.count == 1)
        #expect(store.receiptsPhase == .failed(.forbidden))
    }

    @Test("Detail failure preserves the existing selected detail")
    func detailFailurePreservesSelection() async {
        let store = AutomationStore(dependencies: .stub(loadAutomation: { _ in throw APIError.notFound }))
        store.selectedDetail = FeaturePreviewFixtures.automationDetail

        await store.loadDetail(id: FeaturePreviewFixtures.automationDetail.id)

        #expect(store.selectedDetail?.id == FeaturePreviewFixtures.automationDetail.id)
        #expect(store.detailPhase == .failed(.notFound))
    }

    @Test("Update success reloads data and reports shared mutation state")
    func updateSuccess() async {
        let store = AutomationStore(dependencies: .stub())
        store.selectedAutomationID = FeaturePreviewFixtures.automationRecord.id

        await store.update(id: FeaturePreviewFixtures.automationRecord.id, enabled: false)

        #expect(store.mutationState == .succeeded("Automation updated"))
        #expect(store.loadPhase == .loaded)
        #expect(store.detailPhase == .idle)
    }
}

@MainActor
@Suite("Home Store")
struct HomeStoreRolloutTests {
    @Test("Initial load failure yields a failed root phase")
    func initialLoadFailure() async {
        let store = HomeStore(dependencies: .init(loadSummary: { _ in throw APIError.transportUnavailable }))

        await store.load()

        #expect(store.loadPhase == .failed(.transportUnavailable))
        #expect(store.summary == nil)
    }

    @Test("Refresh failure preserves existing summary and sets refresh phase")
    func refreshFailurePreservesSummary() async {
        let store = HomeStore(dependencies: .init(loadSummary: { _ in throw APIError.forbidden }))
        store.summary = FeaturePreviewFixtures.homeSummary
        store.loadPhase = .loaded

        await store.load()

        #expect(store.summary?.workspaceId == FeaturePreviewFixtures.homeSummary.workspaceId)
        #expect(store.refreshPhase == .failed(.forbidden))
        #expect(store.loadPhase == .loaded)
    }

    @Test("Successful refresh clears stale refresh errors")
    func refreshSuccessClearsError() async {
        let store = HomeStore(dependencies: .init(loadSummary: { _ in FeaturePreviewFixtures.homeSummary }))
        store.summary = FeaturePreviewFixtures.homeSummary
        store.loadPhase = .loaded
        store.refreshPhase = .failed(.transportUnavailable)

        await store.load()

        #expect(store.refreshPhase == .idle)
        #expect(store.loadPhase == .loaded)
    }
}

@MainActor
@Suite("Command Center Store")
struct CommandCenterStoreRolloutTests {
    @Test("Initial load failure yields a failed root phase")
    func initialLoadFailure() async {
        let store = CommandCenterStore(dependencies: .stub(loadRuns: { throw APIError.transportUnavailable }), pollingEnabled: false)

        await store.load()

        #expect(store.loadPhase == .failed(.transportUnavailable))
        #expect(store.lastUpdated == nil)
    }

    @Test("Refresh failure preserves existing dashboard data")
    func refreshFailurePreservesData() async {
        let store = CommandCenterStore(dependencies: .stub(loadRuns: { throw APIError.forbidden }), pollingEnabled: false)
        store.runs = [FeaturePreviewFixtures.commandCenterRun]
        store.jobs = [FeaturePreviewFixtures.commandCenterJob]
        store.tasks = [FeaturePreviewFixtures.commandCenterTask]
        store.interventions = [FeaturePreviewFixtures.commandCenterIntervention]
        store.usage = FeaturePreviewFixtures.dashboardSnapshot.usage
        store.scheduler = FeaturePreviewFixtures.dashboardSnapshot.scheduler
        store.lastUpdated = .now
        store.loadPhase = .loaded

        await store.load()

        #expect(store.runs.count == 1)
        #expect(store.refreshPhase == .failed(.forbidden))
        #expect(store.loadPhase == .loaded)
    }

    @Test("Retry mutation reports through shared mutation state")
    func retryRunSuccess() async {
        let store = CommandCenterStore(dependencies: .stub(), pollingEnabled: false)

        await store.retryRun(id: FeaturePreviewFixtures.commandCenterRun.id)

        #expect(store.mutationState == .succeeded("Run retry initiated"))
    }
}

private extension MemoryStore.Dependencies {
    static func stub(
        listMemories: @Sendable @escaping (_ workspaceID: String, _ limit: Int) async throws -> [MemoryRecordDTO] = { _, _ in FeaturePreviewFixtures.memoryRecords },
        searchMemories: @Sendable @escaping (_ workspaceID: String, _ query: String, _ limit: Int) async throws -> MemorySearchResponseDTO = { _, query, _ in FeaturePreviewFixtures.memorySearchResponse(query: query, results: FeaturePreviewFixtures.memorySearchHits) },
        loadMemoryDetail: @Sendable @escaping (_ id: String) async throws -> MemoryRecordDTO = { _ in FeaturePreviewFixtures.memoryRecord },
        loadMemoryHistory: @Sendable @escaping (_ id: String) async throws -> MemoryHistoryDTO = { _ in FeaturePreviewFixtures.memoryHistory },
        pinMemory: @Sendable @escaping (_ id: String, _ targetKind: String, _ reason: String?) async throws -> Void = { _, _, _ in },
        forgetMemory: @Sendable @escaping (_ id: String, _ reason: String?) async throws -> Void = { _, _ in },
        proposePromotion: @Sendable @escaping (_ id: String, _ targetPath: String) async throws -> MemoryPromotionProposalDTO = { _, _ in FeaturePreviewFixtures.memoryPromotionProposal },
        executePromotion: @Sendable @escaping (_ id: String, _ input: MemoryPromotionExecuteInput) async throws -> Void = { _, _ in }
    ) -> Self {
        Self(
            listMemories: listMemories,
            searchMemories: searchMemories,
            loadMemoryDetail: loadMemoryDetail,
            loadMemoryHistory: loadMemoryHistory,
            pinMemory: pinMemory,
            forgetMemory: forgetMemory,
            proposePromotion: proposePromotion,
            executePromotion: executePromotion
        )
    }
}

private extension AutomationStore.Dependencies {
    static func stub(
        loadAutomations: @Sendable @escaping (_ workspaceID: String) async throws -> [AutomationRecordDTO] = { _ in [FeaturePreviewFixtures.automationRecord] },
        loadAutomation: @Sendable @escaping (_ id: String) async throws -> AutomationDetailDTO = { _ in FeaturePreviewFixtures.automationDetail },
        loadMutationReceipts: @Sendable @escaping (_ component: String?, _ limit: Int) async throws -> [MutationReceiptDTO] = { _, _ in [FeaturePreviewFixtures.automationMutationReceipt] },
        updateAutomation: @Sendable @escaping (_ id: String, _ input: AutomationUpdateInput) async throws -> Void = { _, _ in },
        runAutomationNow: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
        pauseAutomation: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
        resumeAutomation: @Sendable @escaping (_ id: String) async throws -> Void = { _ in }
    ) -> Self {
        Self(
            loadAutomations: loadAutomations,
            loadAutomation: loadAutomation,
            loadMutationReceipts: loadMutationReceipts,
            updateAutomation: updateAutomation,
            runAutomationNow: runAutomationNow,
            pauseAutomation: pauseAutomation,
            resumeAutomation: resumeAutomation
        )
    }
}

private extension CommandCenterStore.Dependencies {
    static func stub(
        loadRuns: @Sendable @escaping () async throws -> [RunRecordDTO] = { [FeaturePreviewFixtures.commandCenterRun] },
        loadJobs: @Sendable @escaping () async throws -> [JobRecordDTO] = { [FeaturePreviewFixtures.commandCenterJob] },
        loadTasks: @Sendable @escaping () async throws -> [TaskRecordDTO] = { [FeaturePreviewFixtures.commandCenterTask] },
        loadInterventions: @Sendable @escaping () async throws -> [InterventionDTO] = { [FeaturePreviewFixtures.commandCenterIntervention] },
        loadDashboardSnapshot: @Sendable @escaping () async throws -> DashboardSnapshot = { FeaturePreviewFixtures.dashboardSnapshot },
        retryRun: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
        cancelRun: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
        pauseJob: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
        resumeJob: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
        enqueueJob: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
        resolveIntervention: @Sendable @escaping (_ id: String, _ note: String?) async throws -> Void = { _, _ in }
    ) -> Self {
        Self(
            loadRuns: loadRuns,
            loadJobs: loadJobs,
            loadTasks: loadTasks,
            loadInterventions: loadInterventions,
            loadDashboardSnapshot: loadDashboardSnapshot,
            retryRun: retryRun,
            cancelRun: cancelRun,
            pauseJob: pauseJob,
            resumeJob: resumeJob,
            enqueueJob: enqueueJob,
            resolveIntervention: resolveIntervention
        )
    }
}
