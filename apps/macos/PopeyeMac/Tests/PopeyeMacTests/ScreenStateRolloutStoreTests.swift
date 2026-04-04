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
    let store = MemoryStore(
      dependencies: .stub(searchMemories: { _, _, _ in throw APIError.forbidden }))
    store.searchText = "daily review"
    store.searchResults = FeaturePreviewFixtures.memorySearchResponse(
      query: store.searchText, results: FeaturePreviewFixtures.memorySearchHits)

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
    let store = MemoryStore(
      dependencies: .stub(loadMemoryHistory: { _ in throw APIError.notFound }))
    store.selectedMemoryId = FeaturePreviewFixtures.memoryRecord.id
    store.memoryHistory = FeaturePreviewFixtures.memoryHistory

    await store.loadHistory(id: FeaturePreviewFixtures.memoryRecord.id)

    #expect(store.memoryHistory?.memoryId == FeaturePreviewFixtures.memoryHistory.memoryId)
    #expect(store.historyPhase == .failed(.notFound))
  }

  @Test("Pin success reports through shared mutation state")
  func pinSuccess() async {
    let store = MemoryStore(
      dependencies: .stub(
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
@Suite("Knowledge Store")
struct KnowledgeStoreRolloutTests {
  @Test("Load selects the first knowledge document and hydrates detail")
  func loadHydratesSelection() async {
    let store = KnowledgeStore(dependencies: .stub())

    await store.load()

    #expect(store.loadPhase == .loaded)
    #expect(store.converters.count == 2)
    #expect(store.latestBetaRun?.id == "knowledge-beta-run-1")
    #expect(store.selectedDocumentID == "knowledge-doc-1")
    #expect(store.selectedDocumentDetail?.id == "knowledge-doc-1")
    #expect(store.proposedRevision?.status == "draft")
    #expect(store.sourceSnapshots.count == 1)
    #expect(store.audit?.totalDocuments == 1)
  }

  @Test("Load tolerates the absence of stored beta runs")
  func loadWithoutBetaRun() async {
    let store = KnowledgeStore(
      dependencies: .stub(
        listBetaRuns: { _, _ in [] }
      ))

    await store.load()

    #expect(store.loadPhase == .loaded)
    #expect(store.latestBetaRun == nil)
  }

  @Test("Review draft captures a proposed revision")
  func reviewDraftCreatesProposal() async {
    let store = KnowledgeStore(dependencies: .stub())
    await store.load()
    store.draftMarkdown = "# Updated Wiki\n\nFresh draft.\n"

    await store.reviewDraft()

    #expect(store.proposedRevision?.id == "knowledge-revision-1")
    #expect(store.revisionPhase == .idle)
  }

  @Test("Import success switches to wiki mode when a draft revision is created")
  func importSwitchesToWiki() async {
    let store = KnowledgeStore(dependencies: .stub())

    await store.importSource(
      KnowledgeImportInput(
        workspaceId: "default",
        sourceType: "manual_text",
        title: "Compiler Notes",
        sourceText: "Important compiler note."
      )
    )

    #expect(store.mode == .wiki)
    #expect(store.selectedDocumentID == "knowledge-doc-1")
    #expect(store.mutationState == .succeeded("Knowledge source imported"))
  }

  @Test("Apply draft uses the wrapped apply result and refreshes selected detail")
  func applyDraftUsesWrappedResult() async {
    actor ApplyState {
      private var didApply = false

      func current() -> Bool { didApply }
      func markApplied() { didApply = true }
    }

    let applyState = ApplyState()
    let store = KnowledgeStore(
      dependencies: .stub(
        loadDocument: { _ in
          await applyState.current()
            ? sampleKnowledgeDetail(markdownText: "# Applied Wiki\n\nMerged.\n", revisionHash: "rev-2")
            : sampleKnowledgeDetail()
        },
        applyRevision: { _, _ in
          await applyState.markApplied()
          return sampleKnowledgeApplyResult()
        }
      ))
    await store.load()
    await store.reviewDraft()

    await store.applyReviewedDraft()

    #expect(store.selectedDocumentDetail?.revisionHash == "rev-2")
    #expect(store.mutationState == .succeeded("Knowledge revision applied"))
  }

  @Test("Reject draft uses the wrapped reject result and keeps document content unchanged")
  func rejectDraftUsesWrappedResult() async {
    actor RejectState {
      private var rejected = false
      func current() -> Bool { rejected }
      func markRejected() { rejected = true }
    }

    let state = RejectState()
    let store = KnowledgeStore(
      dependencies: .stub(
        listRevisions: { _ in
          await state.current() ? [] : [sampleKnowledgeRevision()]
        },
        rejectRevision: { _ in
          await state.markRejected()
          return sampleKnowledgeRejectResult()
        }
      ))
    await store.load()

    await store.rejectReviewedDraft()

    #expect(store.proposedRevision == nil)
    #expect(store.mutationState == .succeeded("Knowledge revision rejected"))
  }

  @Test("Discard restores server markdown and clears local edits")
  func discardDraftRestoresServerMarkdown() async {
    let store = KnowledgeStore(dependencies: .stub())
    await store.load()
    store.draftMarkdown = "# Local Edit\n\nChanged.\n"

    store.discardLocalDraft()

    #expect(store.draftMarkdown == sampleKnowledgeDetail().markdownText)
    #expect(store.isDirty == false)
  }

  @Test("Reingest refreshes the selected source and reports success")
  func reingestRefreshesSelectedSource() async {
    actor ReingestState {
      private var refreshed = false

      func current() -> Bool { refreshed }
      func markRefreshed() { refreshed = true }
    }

    let state = ReingestState()
    let store = KnowledgeStore(
      dependencies: .stub(
        listSources: { _ in
          let source = sampleKnowledgeSource(
            latestOutcome: await state.current() ? "updated" : "created")
          return [source]
        },
        reingestSource: { _ in
          await state.markRefreshed()
          return sampleKnowledgeImportResult(outcome: "updated")
        }
      ))
    await store.load()

    await store.reingestSelectedSource()

    #expect(store.selectedSource?.latestOutcome == "updated")
    #expect(store.mutationState == .succeeded("Knowledge source refreshed"))
  }
}

@MainActor
@Suite("Automation Store")
struct AutomationStoreRolloutTests {
  @Test("Root load failure surfaces a failed root phase")
  func loadFailure() async {
    let store = AutomationStore(
      dependencies: .stub(loadAutomations: { _ in throw APIError.transportUnavailable }))

    await store.load()

    #expect(store.loadPhase == .failed(.transportUnavailable))
  }

  @Test("Receipt failure keeps automation content visible")
  func receiptsFailureDoesNotFailScreen() async {
    let store = AutomationStore(
      dependencies: .stub(
        loadMutationReceipts: { _, _ in throw APIError.forbidden }
      ))

    await store.load()

    #expect(store.loadPhase == .loaded)
    #expect(store.automations.count == 1)
    #expect(store.receiptsPhase == .failed(.forbidden))
  }

  @Test("Detail failure preserves the existing selected detail")
  func detailFailurePreservesSelection() async {
    let store = AutomationStore(
      dependencies: .stub(loadAutomation: { _ in throw APIError.notFound }))
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
    let store = HomeStore(
      dependencies: .init(loadSummary: { _ in throw APIError.transportUnavailable }))

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
    let store = HomeStore(
      dependencies: .init(loadSummary: { _ in FeaturePreviewFixtures.homeSummary }))
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
    let store = CommandCenterStore(
      dependencies: .stub(loadRuns: { throw APIError.transportUnavailable }), pollingEnabled: false)

    await store.load()

    #expect(store.loadPhase == .failed(.transportUnavailable))
    #expect(store.lastUpdated == nil)
  }

  @Test("Refresh failure preserves existing dashboard data")
  func refreshFailurePreservesData() async {
    let store = CommandCenterStore(
      dependencies: .stub(loadRuns: { throw APIError.forbidden }), pollingEnabled: false)
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

extension MemoryStore.Dependencies {
  fileprivate static func stub(
    listMemories:
      @Sendable @escaping (_ workspaceID: String, _ limit: Int) async throws -> [MemoryRecordDTO] =
      { _, _ in FeaturePreviewFixtures.memoryRecords },
    searchMemories:
      @Sendable @escaping (_ workspaceID: String, _ query: String, _ limit: Int) async throws ->
      MemorySearchResponseDTO = { _, query, _ in
        FeaturePreviewFixtures.memorySearchResponse(
          query: query, results: FeaturePreviewFixtures.memorySearchHits)
      },
    loadMemoryDetail: @Sendable @escaping (_ id: String) async throws -> MemoryRecordDTO = { _ in
      FeaturePreviewFixtures.memoryRecord
    },
    loadMemoryHistory: @Sendable @escaping (_ id: String) async throws -> MemoryHistoryDTO = { _ in
      FeaturePreviewFixtures.memoryHistory
    },
    pinMemory:
      @Sendable @escaping (_ id: String, _ targetKind: String, _ reason: String?) async throws ->
      Void = { _, _, _ in },
    forgetMemory: @Sendable @escaping (_ id: String, _ reason: String?) async throws -> Void = {
      _, _ in
    },
    proposePromotion:
      @Sendable @escaping (_ id: String, _ targetPath: String) async throws ->
      MemoryPromotionProposalDTO = { _, _ in FeaturePreviewFixtures.memoryPromotionProposal },
    executePromotion:
      @Sendable @escaping (_ id: String, _ input: MemoryPromotionExecuteInput) async throws -> Void =
      { _, _ in }
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

extension KnowledgeStore.Dependencies {
  fileprivate static func stub(
    listSources: @Sendable @escaping (_ workspaceID: String) async throws -> [KnowledgeSourceDTO] =
      { _ in [sampleKnowledgeSource()] },
    listSourceSnapshots: @Sendable @escaping (_ sourceID: String) async throws -> [KnowledgeSourceSnapshotDTO] =
      { _ in [sampleKnowledgeSnapshot()] },
    listConverters: @Sendable @escaping () async throws -> [KnowledgeConverterAvailabilityDTO] = {
      [
        sampleKnowledgeConverter(
          id: "markitdown",
          status: "ready",
          details: "MarkItDown is available.",
          usedFor: ["local_file", "pdf", "image"],
          fallbackRank: 1
        ),
        sampleKnowledgeConverter(
          id: "docling",
          status: "missing",
          details: "Docling is unavailable.",
          usedFor: ["local_file", "pdf", "image"],
          fallbackRank: 2
        ),
      ]
    },
    listBetaRuns:
      @Sendable @escaping (_ workspaceID: String, _ limit: Int) async throws ->
      [KnowledgeBetaRunRecordDTO] = { _, _ in
        [sampleKnowledgeBetaRunRecord()]
      },
    loadBetaRun: @Sendable @escaping (_ id: String) async throws -> KnowledgeBetaRunDetailDTO = {
      _ in sampleKnowledgeBetaRunDetail()
    },
    listDocuments:
      @Sendable @escaping (_ workspaceID: String, _ kind: String?, _ query: String?) async throws ->
      [KnowledgeDocumentDTO] = { _, kind, _ in
        let document = sampleKnowledgeDocument(kind: kind ?? "wiki_article")
        return [document]
      },
    loadDocument: @Sendable @escaping (_ id: String) async throws -> KnowledgeDocumentDetailDTO = {
      _ in sampleKnowledgeDetail()
    },
    listRevisions:
      @Sendable @escaping (_ id: String) async throws -> [KnowledgeDocumentRevisionDTO] = { _ in
        [sampleKnowledgeRevision()]
      },
    loadNeighborhood: @Sendable @escaping (_ id: String) async throws -> KnowledgeNeighborhoodDTO =
      { _ in sampleKnowledgeNeighborhood() },
    listCompileJobs:
      @Sendable @escaping (_ workspaceID: String) async throws -> [KnowledgeCompileJobDTO] = { _ in
        [sampleKnowledgeCompileJob()]
      },
    loadAudit: @Sendable @escaping (_ workspaceID: String) async throws -> KnowledgeAuditDTO = {
      _ in sampleKnowledgeAudit()
    },
    importSource:
      @Sendable @escaping (_ input: KnowledgeImportInput) async throws -> KnowledgeImportResultDTO =
      { _ in sampleKnowledgeImportResult() },
    reingestSource:
      @Sendable @escaping (_ id: String) async throws -> KnowledgeImportResultDTO = { _ in
        sampleKnowledgeImportResult(outcome: "updated")
      },
    proposeRevision:
      @Sendable @escaping (_ id: String, _ input: KnowledgeRevisionProposalInput) async throws ->
      KnowledgeDocumentRevisionDTO = { _, input in
        KnowledgeDocumentRevisionDTO(
          id: "knowledge-revision-1",
          documentId: "knowledge-doc-1",
          workspaceId: "default",
          status: "draft",
          sourceKind: "operator",
          sourceId: nil,
          proposedTitle: "Compiler Notes",
          proposedMarkdown: input.markdownText,
          diffPreview: "+ Fresh draft.",
          baseRevisionHash: "rev-1",
          createdAt: "2026-04-04T10:00:00Z",
          appliedAt: nil
        )
      },
    applyRevision:
      @Sendable @escaping (_ id: String, _ input: KnowledgeRevisionApplyInput) async throws ->
      KnowledgeRevisionApplyResultDTO = { _, _ in
        sampleKnowledgeApplyResult()
      },
    rejectRevision:
      @Sendable @escaping (_ id: String) async throws -> KnowledgeRevisionRejectResultDTO = { _ in
        sampleKnowledgeRejectResult()
      },
    createLink:
      @Sendable @escaping (_ input: KnowledgeLinkCreateInput) async throws -> KnowledgeLinkDTO = {
        input in
        KnowledgeLinkDTO(
          id: "knowledge-link-2",
          workspaceId: "default",
          sourceDocumentId: input.sourceDocumentId,
          targetDocumentId: input.targetDocumentId,
          targetSlug: input.targetSlug,
          targetLabel: input.targetLabel,
          linkKind: input.linkKind,
          linkStatus: "active",
          confidence: 1,
          createdAt: "2026-04-04T10:00:00Z",
          updatedAt: "2026-04-04T10:00:00Z"
        )
      }
  ) -> Self {
    Self(
      listSources: listSources,
      listSourceSnapshots: listSourceSnapshots,
      listConverters: listConverters,
      listBetaRuns: listBetaRuns,
      loadBetaRun: loadBetaRun,
      listDocuments: listDocuments,
      loadDocument: loadDocument,
      listRevisions: listRevisions,
      loadNeighborhood: loadNeighborhood,
      listCompileJobs: listCompileJobs,
      loadAudit: loadAudit,
      importSource: importSource,
      reingestSource: reingestSource,
      proposeRevision: proposeRevision,
      applyRevision: applyRevision,
      rejectRevision: rejectRevision,
      createLink: createLink
    )
  }
}

extension AutomationStore.Dependencies {
  fileprivate static func stub(
    loadAutomations:
      @Sendable @escaping (_ workspaceID: String) async throws -> [AutomationRecordDTO] = { _ in
        [FeaturePreviewFixtures.automationRecord]
      },
    loadAutomation: @Sendable @escaping (_ id: String) async throws -> AutomationDetailDTO = { _ in
      FeaturePreviewFixtures.automationDetail
    },
    loadMutationReceipts:
      @Sendable @escaping (_ component: String?, _ limit: Int) async throws -> [MutationReceiptDTO] =
      { _, _ in [FeaturePreviewFixtures.automationMutationReceipt] },
    updateAutomation:
      @Sendable @escaping (_ id: String, _ input: AutomationUpdateInput) async throws -> Void = {
        _, _ in
      },
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

extension CommandCenterStore.Dependencies {
  fileprivate static func stub(
    loadRuns: @Sendable @escaping () async throws -> [RunRecordDTO] = {
      [FeaturePreviewFixtures.commandCenterRun]
    },
    loadJobs: @Sendable @escaping () async throws -> [JobRecordDTO] = {
      [FeaturePreviewFixtures.commandCenterJob]
    },
    loadTasks: @Sendable @escaping () async throws -> [TaskRecordDTO] = {
      [FeaturePreviewFixtures.commandCenterTask]
    },
    loadInterventions: @Sendable @escaping () async throws -> [InterventionDTO] = {
      [FeaturePreviewFixtures.commandCenterIntervention]
    },
    loadDashboardSnapshot: @Sendable @escaping () async throws -> DashboardSnapshot = {
      FeaturePreviewFixtures.dashboardSnapshot
    },
    retryRun: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
    cancelRun: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
    pauseJob: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
    resumeJob: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
    enqueueJob: @Sendable @escaping (_ id: String) async throws -> Void = { _ in },
    resolveIntervention: @Sendable @escaping (_ id: String, _ note: String?) async throws -> Void =
      { _, _ in }
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

private func sampleKnowledgeSource(latestOutcome: String = "created") -> KnowledgeSourceDTO {
  KnowledgeSourceDTO(
    id: "knowledge-source-1",
    workspaceId: "default",
    knowledgeRootId: "knowledge-root-1",
    sourceType: "manual_text",
    title: "Compiler Notes",
    originalUri: nil,
    originalPath: nil,
    originalFileName: nil,
    originalMediaType: "text/plain",
    adapter: "native",
    fallbackUsed: false,
    status: "compiled",
    contentHash: "hash-1",
    assetStatus: "none",
    latestOutcome: latestOutcome,
    conversionWarnings: [],
    createdAt: "2026-04-04T10:00:00Z",
    updatedAt: "2026-04-04T10:00:00Z"
  )
}

private func sampleKnowledgeConverter(
  id: String,
  status: String,
  provenance: String = "system",
  details: String,
  usedFor: [String],
  fallbackRank: Int
) -> KnowledgeConverterAvailabilityDTO {
  KnowledgeConverterAvailabilityDTO(
    id: id,
    status: status,
    provenance: provenance,
    details: details,
    version: nil,
    lastCheckedAt: "2026-04-04T10:00:00Z",
    installHint: status == "ready" ? nil : "Install this converter before import.",
    usedFor: usedFor,
    fallbackRank: fallbackRank
  )
}

private func sampleKnowledgeSnapshot() -> KnowledgeSourceSnapshotDTO {
  KnowledgeSourceSnapshotDTO(
    id: "knowledge-snapshot-1",
    sourceId: "knowledge-source-1",
    workspaceId: "default",
    contentHash: "hash-1",
    adapter: "native",
    fallbackUsed: false,
    status: "compiled",
    assetStatus: "none",
    outcome: "created",
    conversionWarnings: [],
    createdAt: "2026-04-04T10:00:00Z"
  )
}

private func sampleKnowledgeBetaRunRecord() -> KnowledgeBetaRunRecordDTO {
  KnowledgeBetaRunRecordDTO(
    id: "knowledge-beta-run-1",
    workspaceId: "default",
    manifestPath: "/private/knowledge-beta-corpus.json",
    importCount: 12,
    reingestCount: 3,
    hardFailureCount: 0,
    importSuccessRate: 1,
    gateStatus: "passed",
    createdAt: "2026-04-04T10:30:00Z"
  )
}

private func sampleKnowledgeBetaRunDetail() -> KnowledgeBetaRunDetailDTO {
  KnowledgeBetaRunDetailDTO(
    id: "knowledge-beta-run-1",
    workspaceId: "default",
    manifestPath: "/private/knowledge-beta-corpus.json",
    importCount: 12,
    reingestCount: 3,
    hardFailureCount: 0,
    importSuccessRate: 1,
    gateStatus: "passed",
    createdAt: "2026-04-04T10:30:00Z",
    reportMarkdown: "# Knowledge beta corpus report\n",
    imports: [
      KnowledgeBetaReportRowDTO(
        label: "Compiler Notes",
        title: "Compiler Notes",
        sourceType: "manual_text",
        outcome: "created",
        sourceId: "knowledge-source-1",
        adapter: "native",
        status: "compiled",
        assetStatus: "none",
        draftRevisionId: "knowledge-revision-0",
        error: nil
      )
    ],
    reingests: [],
    converters: [
      sampleKnowledgeConverter(
        id: "markitdown",
        status: "ready",
        details: "MarkItDown is available.",
        usedFor: ["local_file", "pdf", "image"],
        fallbackRank: 1
      )
    ],
    audit: sampleKnowledgeAudit(),
    gate: KnowledgeBetaGateDTO(
      status: "passed",
      minImportSuccessRate: 0.9,
      actualImportSuccessRate: 1,
      maxHardFailures: 1,
      actualHardFailures: 0,
      expectedReingestChecks: 1,
      failedExpectedReingestChecks: 0,
      checks: [
        KnowledgeBetaGateCheckDTO(
          id: "success-rate",
          label: "Import success rate",
          passed: true,
          details: "100% of imports succeeded."
        )
      ]
    )
  )
}

private func sampleKnowledgeDocument(kind: String = "wiki_article") -> KnowledgeDocumentDTO {
  KnowledgeDocumentDTO(
    id: "knowledge-doc-1",
    workspaceId: "default",
    knowledgeRootId: "knowledge-root-1",
    sourceId: "knowledge-source-1",
    kind: kind,
    title: "Compiler Notes",
    slug: "compiler-notes",
    relativePath: kind == "source_normalized"
      ? "raw/source-1/normalized/source.md" : "wiki/compiler-notes.md",
    revisionHash: "rev-1",
    status: kind == "source_normalized" ? "active" : "draft_only",
    createdAt: "2026-04-04T10:00:00Z",
    updatedAt: "2026-04-04T10:00:00Z"
  )
}

private func sampleKnowledgeDetail(
  markdownText: String = "# Compiler Notes\n\nImportant facts.\n",
  revisionHash: String = "rev-1"
) -> KnowledgeDocumentDetailDTO {
  KnowledgeDocumentDetailDTO(
    id: "knowledge-doc-1",
    workspaceId: "default",
    knowledgeRootId: "knowledge-root-1",
    sourceId: "knowledge-source-1",
    kind: "wiki_article",
    title: "Compiler Notes",
    slug: "compiler-notes",
    relativePath: "wiki/compiler-notes.md",
    revisionHash: revisionHash,
    status: "draft_only",
    createdAt: "2026-04-04T10:00:00Z",
    updatedAt: "2026-04-04T10:00:00Z",
    markdownText: markdownText,
    exists: true,
    sourceIds: ["knowledge-source-1"]
  )
}

private func sampleKnowledgeRevision() -> KnowledgeDocumentRevisionDTO {
  KnowledgeDocumentRevisionDTO(
    id: "knowledge-revision-0",
    documentId: "knowledge-doc-1",
    workspaceId: "default",
    status: "draft",
    sourceKind: "auto_compile",
    sourceId: "knowledge-source-1",
    proposedTitle: "Compiler Notes",
    proposedMarkdown: "# Compiler Notes\n\nImportant facts.\n",
    diffPreview: "+ Important facts.",
    baseRevisionHash: "rev-1",
    createdAt: "2026-04-04T10:00:00Z",
    appliedAt: nil
  )
}

private func sampleKnowledgeNeighborhood() -> KnowledgeNeighborhoodDTO {
  KnowledgeNeighborhoodDTO(
    document: sampleKnowledgeDocument(),
    incoming: [],
    outgoing: [
      KnowledgeLinkDTO(
        id: "knowledge-link-1",
        workspaceId: "default",
        sourceDocumentId: "knowledge-doc-1",
        targetDocumentId: nil,
        targetSlug: "compilers",
        targetLabel: "Compilers",
        linkKind: "wikilink",
        linkStatus: "unresolved",
        confidence: 0.9,
        createdAt: "2026-04-04T10:00:00Z",
        updatedAt: "2026-04-04T10:00:00Z"
      )
    ],
    relatedDocuments: []
  )
}

private func sampleKnowledgeCompileJob() -> KnowledgeCompileJobDTO {
  KnowledgeCompileJobDTO(
    id: "knowledge-job-1",
    workspaceId: "default",
    sourceId: "knowledge-source-1",
    targetDocumentId: "knowledge-doc-1",
    status: "succeeded",
    summary: "Compiled wiki article",
    warnings: [],
    createdAt: "2026-04-04T10:00:00Z",
    updatedAt: "2026-04-04T10:00:00Z"
  )
}

private func sampleKnowledgeAudit() -> KnowledgeAuditDTO {
  KnowledgeAuditDTO(
    totalSources: 1,
    totalDocuments: 1,
    totalDraftRevisions: 1,
    unresolvedLinks: 1,
    brokenLinks: 0,
    failedConversions: 0,
    degradedSources: 0,
    warningSources: 0,
    assetLocalizationFailures: 0,
    lastCompileAt: "2026-04-04T10:00:00Z"
  )
}

private func sampleKnowledgeImportResult(outcome: String = "created") -> KnowledgeImportResultDTO {
  KnowledgeImportResultDTO(
    source: sampleKnowledgeSource(),
    normalizedDocument: sampleKnowledgeDocument(kind: "source_normalized"),
    compileJob: sampleKnowledgeCompileJob(),
    draftRevision: sampleKnowledgeRevision(),
    outcome: outcome
  )
}

private func sampleKnowledgeApplyResult() -> KnowledgeRevisionApplyResultDTO {
  KnowledgeRevisionApplyResultDTO(
    revision: KnowledgeDocumentRevisionDTO(
      id: "knowledge-revision-1",
      documentId: "knowledge-doc-1",
      workspaceId: "default",
      status: "applied",
      sourceKind: "manual",
      sourceId: nil,
      proposedTitle: "Compiler Notes",
      proposedMarkdown: "# Applied Wiki\n\nMerged.\n",
      diffPreview: "+ Merged.",
      baseRevisionHash: "rev-1",
      createdAt: "2026-04-04T10:00:00Z",
      appliedAt: "2026-04-04T10:01:00Z"
    ),
    document: sampleKnowledgeDetail(
      markdownText: "# Applied Wiki\n\nMerged.\n", revisionHash: "rev-2"),
    receipt: MutationReceiptDTO(
      id: "receipt-knowledge-1",
      kind: "knowledge_revision_apply",
      component: "knowledge",
      status: "succeeded",
      summary: "Knowledge revision applied",
      details: "Applied knowledge revision knowledge-revision-1.",
      actorRole: "operator",
      workspaceId: "default",
      usage: ReceiptUsageDTO(
        provider: "internal", model: "none", tokensIn: 0, tokensOut: 0,
        estimatedCostUsd: 0),
      metadata: [
        "documentId": "knowledge-doc-1",
        "revisionId": "knowledge-revision-1",
      ],
      createdAt: "2026-04-04T10:01:00Z"
    )
  )
}

private func sampleKnowledgeRejectResult() -> KnowledgeRevisionRejectResultDTO {
  KnowledgeRevisionRejectResultDTO(
    revision: KnowledgeDocumentRevisionDTO(
      id: "knowledge-revision-1",
      documentId: "knowledge-doc-1",
      workspaceId: "default",
      status: "rejected",
      sourceKind: "manual",
      sourceId: nil,
      proposedTitle: "Compiler Notes",
      proposedMarkdown: "# Compiler Notes\n\nImportant facts.\n",
      diffPreview: "- Rejected.",
      baseRevisionHash: "rev-1",
      createdAt: "2026-04-04T10:00:00Z",
      appliedAt: nil
    ),
    document: sampleKnowledgeDetail(),
    receipt: MutationReceiptDTO(
      id: "receipt-knowledge-2",
      kind: "knowledge_revision_reject",
      component: "knowledge",
      status: "succeeded",
      summary: "Knowledge revision rejected",
      details: "Rejected knowledge revision knowledge-revision-1.",
      actorRole: "operator",
      workspaceId: "default",
      usage: ReceiptUsageDTO(
        provider: "internal", model: "none", tokensIn: 0, tokensOut: 0,
        estimatedCostUsd: 0),
      metadata: [
        "documentId": "knowledge-doc-1",
        "revisionId": "knowledge-revision-1",
      ],
      createdAt: "2026-04-04T10:01:00Z"
    )
  )
}
