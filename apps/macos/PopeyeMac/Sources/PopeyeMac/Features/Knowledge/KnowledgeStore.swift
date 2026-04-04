import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class KnowledgeStore {
  enum Mode: String, CaseIterable {
    case sources
    case wiki
    case outputs

    var title: String {
      switch self {
      case .sources: "Sources"
      case .wiki: "Wiki"
      case .outputs: "Outputs"
      }
    }

    var kind: String {
      switch self {
      case .sources: "source_normalized"
      case .wiki: "wiki_article"
      case .outputs: "output_note"
      }
    }

    static func from(documentKind: String) -> Mode {
      switch documentKind {
      case "source_normalized": .sources
      case "output_note": .outputs
      default: .wiki
      }
    }
  }

  struct Dependencies: Sendable {
    var listSources: @Sendable (_ workspaceID: String) async throws -> [KnowledgeSourceDTO]
    var listSourceSnapshots: @Sendable (_ sourceID: String) async throws -> [KnowledgeSourceSnapshotDTO]
    var listConverters: @Sendable () async throws -> [KnowledgeConverterAvailabilityDTO]
    var listBetaRuns:
      @Sendable (_ workspaceID: String, _ limit: Int) async throws -> [KnowledgeBetaRunRecordDTO]
    var loadBetaRun: @Sendable (_ id: String) async throws -> KnowledgeBetaRunDetailDTO
    var listDocuments:
      @Sendable (_ workspaceID: String, _ kind: String?, _ query: String?) async throws ->
        [KnowledgeDocumentDTO]
    var loadDocument: @Sendable (_ id: String) async throws -> KnowledgeDocumentDetailDTO
    var listRevisions: @Sendable (_ id: String) async throws -> [KnowledgeDocumentRevisionDTO]
    var loadNeighborhood: @Sendable (_ id: String) async throws -> KnowledgeNeighborhoodDTO
    var listCompileJobs: @Sendable (_ workspaceID: String) async throws -> [KnowledgeCompileJobDTO]
    var loadAudit: @Sendable (_ workspaceID: String) async throws -> KnowledgeAuditDTO
    var importSource:
      @Sendable (_ input: KnowledgeImportInput) async throws -> KnowledgeImportResultDTO
    var reingestSource: @Sendable (_ id: String) async throws -> KnowledgeImportResultDTO
    var proposeRevision:
      @Sendable (_ id: String, _ input: KnowledgeRevisionProposalInput) async throws ->
        KnowledgeDocumentRevisionDTO
    var applyRevision:
      @Sendable (_ id: String, _ input: KnowledgeRevisionApplyInput) async throws ->
        KnowledgeRevisionApplyResultDTO
    var rejectRevision: @Sendable (_ id: String) async throws -> KnowledgeRevisionRejectResultDTO
    var createLink: @Sendable (_ input: KnowledgeLinkCreateInput) async throws -> KnowledgeLinkDTO

    static func live(client: ControlAPIClient) -> Dependencies {
      Dependencies(
        listSources: { workspaceID in
          try await client.listKnowledgeSources(workspaceId: workspaceID)
        },
        listSourceSnapshots: { sourceID in
          try await client.listKnowledgeSourceSnapshots(id: sourceID)
        },
        listConverters: {
          try await client.listKnowledgeConverters()
        },
        listBetaRuns: { workspaceID, limit in
          try await client.listKnowledgeBetaRuns(workspaceId: workspaceID, limit: limit)
        },
        loadBetaRun: { id in
          try await client.getKnowledgeBetaRun(id: id)
        },
        listDocuments: { workspaceID, kind, query in
          try await client.listKnowledgeDocuments(
            workspaceId: workspaceID, kind: kind, query: query)
        },
        loadDocument: { id in
          try await client.getKnowledgeDocument(id: id)
        },
        listRevisions: { id in
          try await client.listKnowledgeDocumentRevisions(id: id)
        },
        loadNeighborhood: { id in
          try await client.getKnowledgeNeighborhood(id: id)
        },
        listCompileJobs: { workspaceID in
          try await client.listKnowledgeCompileJobs(workspaceId: workspaceID)
        },
        loadAudit: { workspaceID in
          try await client.getKnowledgeAudit(workspaceId: workspaceID)
        },
        importSource: { input in
          try await client.importKnowledgeSource(input: input)
        },
        reingestSource: { id in
          try await client.reingestKnowledgeSource(id: id)
        },
        proposeRevision: { id, input in
          try await client.proposeKnowledgeDocumentRevision(id: id, input: input)
        },
        applyRevision: { id, input in
          try await client.applyKnowledgeRevision(id: id, input: input)
        },
        rejectRevision: { id in
          try await client.rejectKnowledgeRevision(id: id)
        },
        createLink: { input in
          try await client.createKnowledgeLink(input: input)
        }
      )
    }
  }

  var workspaceID = "default" {
    didSet {
      guard oldValue != workspaceID else { return }
      resetState()
    }
  }

  var mode: Mode = .wiki
  var searchText = ""

  var sources: [KnowledgeSourceDTO] = []
  var sourceSnapshots: [KnowledgeSourceSnapshotDTO] = []
  var converters: [KnowledgeConverterAvailabilityDTO] = []
  var latestBetaRun: KnowledgeBetaRunDetailDTO?
  var documents: [KnowledgeDocumentDTO] = []
  var selectedDocumentID: String?
  var selectedDocumentDetail: KnowledgeDocumentDetailDTO?
  var revisions: [KnowledgeDocumentRevisionDTO] = []
  var neighborhood: KnowledgeNeighborhoodDTO?
  var compileJobs: [KnowledgeCompileJobDTO] = []
  var audit: KnowledgeAuditDTO?
  var draftMarkdown = "" {
    didSet {
      guard draftMarkdown != oldValue else { return }
      proposedRevision = nil
    }
  }
  var proposedRevision: KnowledgeDocumentRevisionDTO?

  var newLinkLabel = ""
  var newLinkSlug = ""

  var showImportSheet = false

  var loadPhase: ScreenLoadPhase = .idle
  var detailPhase: ScreenOperationPhase = .idle
  var revisionPhase: ScreenOperationPhase = .idle
  var linkPhase: ScreenOperationPhase = .idle

  let mutations = MutationExecutor()
  var mutationState: MutationState { mutations.state }

  private let dependencies: Dependencies

  init(client: ControlAPIClient) {
    self.dependencies = .live(client: client)
  }

  init(dependencies: Dependencies) {
    self.dependencies = dependencies
  }

  var error: APIError? { loadPhase.error }
  var detailError: APIError? { detailPhase.error }
  var revisionError: APIError? { revisionPhase.error }
  var linkError: APIError? { linkPhase.error }

  var selectedDocument: KnowledgeDocumentDTO? {
    guard let selectedDocumentID else { return nil }
    return documents.first(where: { $0.id == selectedDocumentID })
  }

  var selectedSource: KnowledgeSourceDTO? {
    guard let sourceID = selectedDocumentDetail?.sourceIds.first ?? selectedDocument?.sourceId
    else { return nil }
    return sources.first(where: { $0.id == sourceID })
  }

  var isEditable: Bool {
    selectedDocumentDetail?.kind != Mode.sources.kind
  }

  var isDirty: Bool {
    normalize(draftMarkdown) != normalize(selectedDocumentDetail?.markdownText ?? "")
  }

  var selectedCompileJobs: [KnowledgeCompileJobDTO] {
    guard let selectedDocument else { return compileJobs.prefix(8).map { $0 } }
    return compileJobs.filter { job in
      job.targetDocumentId == selectedDocument.id || job.sourceId == selectedDocument.sourceId
    }
  }

  var betaIssues: [KnowledgeBetaReportRowDTO] {
    guard let latestBetaRun else { return [] }
    return (latestBetaRun.imports + latestBetaRun.reingests).filter { row in
      row.error != nil
        || row.status == "degraded"
        || row.status == "compiled_with_warnings"
        || row.status == "conversion_failed"
        || row.assetStatus == "partial_failure"
        || row.assetStatus == "failed"
    }
  }

  func load() async {
    loadPhase = .loading
    do {
      async let sourcesTask = dependencies.listSources(workspaceID)
      async let convertersTask = dependencies.listConverters()
      async let documentsTask = dependencies.listDocuments(
        workspaceID, mode.kind, trimmedSearchQuery)
      async let compileJobsTask = dependencies.listCompileJobs(workspaceID)
      async let auditTask = dependencies.loadAudit(workspaceID)
      async let latestBetaRunTask = loadLatestBetaRun()

      let (
        loadedSources,
        loadedConverters,
        loadedDocuments,
        loadedCompileJobs,
        loadedAudit,
        loadedLatestBetaRun
      ) = try await (
        sourcesTask,
        convertersTask,
        documentsTask,
        compileJobsTask,
        auditTask,
        latestBetaRunTask
      )

      sources = loadedSources
      converters = loadedConverters.sorted { lhs, rhs in
        lhs.fallbackRank == rhs.fallbackRank ? lhs.id < rhs.id : lhs.fallbackRank < rhs.fallbackRank
      }
      latestBetaRun = loadedLatestBetaRun
      documents = loadedDocuments
      compileJobs = loadedCompileJobs.sorted { $0.updatedAt > $1.updatedAt }
      audit = loadedAudit

      if let selectedDocumentID,
        documents.contains(where: { $0.id == selectedDocumentID })
      {
        await loadDocument(id: selectedDocumentID)
      } else if let first = documents.first {
        selectedDocumentID = first.id
        await loadDocument(id: first.id)
      } else {
        clearDocumentState()
      }

      loadPhase = documents.isEmpty && sources.isEmpty ? .empty : .loaded
    } catch {
      loadPhase = .failed(APIError.from(error))
    }
  }

  func loadDocument(id: String) async {
    detailPhase = .loading
    do {
      let document = try await dependencies.loadDocument(id)
      async let revisionsTask = dependencies.listRevisions(id)
      async let neighborhoodTask = dependencies.loadNeighborhood(id)
      let loadedSnapshots: [KnowledgeSourceSnapshotDTO]
      if let sourceID = document.sourceIds.first ?? document.sourceId {
        async let snapshotsTask = dependencies.listSourceSnapshots(sourceID)
        let snapshots = try await snapshotsTask
        loadedSnapshots = snapshots
      } else {
        loadedSnapshots = []
      }
      let (loadedRevisions, loadedNeighborhood) = try await (
        revisionsTask, neighborhoodTask
      )
      selectedDocumentID = id
      selectedDocumentDetail = document
      revisions = loadedRevisions.sorted { $0.createdAt > $1.createdAt }
      neighborhood = loadedNeighborhood
      sourceSnapshots = loadedSnapshots
      draftMarkdown = document.markdownText
      proposedRevision = revisions.first(where: { $0.status == "draft" })
      detailPhase = .idle
    } catch {
      detailPhase = .failed(APIError.from(error))
    }
  }

  func reviewDraft() async {
    guard let selectedDocumentDetail, isEditable else { return }
    revisionPhase = .loading
    do {
      proposedRevision = try await dependencies.proposeRevision(
        selectedDocumentDetail.id,
        KnowledgeRevisionProposalInput(
          title: selectedDocumentDetail.title,
          markdownText: draftMarkdown,
          baseRevisionHash: selectedDocumentDetail.revisionHash
        )
      )
      revisionPhase = .idle
    } catch {
      revisionPhase = .failed(APIError.from(error))
    }
  }

  func applyReviewedDraft() async {
    guard let proposedRevision else { return }
    var appliedResult: KnowledgeRevisionApplyResultDTO?
    await mutations.execute(
      action: { [dependencies] in
        appliedResult = try await dependencies.applyRevision(
          proposedRevision.id, KnowledgeRevisionApplyInput())
      },
      successMessage: "Knowledge revision applied",
      fallbackError: "Could not apply revision",
      reload: { [weak self] in
        guard let self else { return }
        if let appliedDetail = appliedResult?.document {
          self.selectedDocumentID = appliedDetail.id
          self.selectedDocumentDetail = appliedDetail
          self.draftMarkdown = appliedDetail.markdownText
        }
        self.proposedRevision = nil
        if let selectedDocumentID = self.selectedDocumentID {
          await self.loadDocument(id: selectedDocumentID)
        }
        await self.refreshListsOnly()
      }
    )
  }

  func rejectReviewedDraft() async {
    guard let proposedRevision else { return }
    var rejectedResult: KnowledgeRevisionRejectResultDTO?
    await mutations.execute(
      action: { [dependencies] in
        rejectedResult = try await dependencies.rejectRevision(proposedRevision.id)
      },
      successMessage: "Knowledge revision rejected",
      fallbackError: "Could not reject revision",
      reload: { [weak self] in
        guard let self else { return }
        self.proposedRevision = nil
        if let rejectedDetail = rejectedResult?.document {
          self.selectedDocumentID = rejectedDetail.id
          self.selectedDocumentDetail = rejectedDetail
          self.draftMarkdown = rejectedDetail.markdownText
        }
        if let selectedDocumentID = self.selectedDocumentID {
          await self.loadDocument(id: selectedDocumentID)
        }
        await self.refreshListsOnly()
      }
    )
  }

  func discardLocalDraft() {
    guard let selectedDocumentDetail else { return }
    draftMarkdown = selectedDocumentDetail.markdownText
    proposedRevision = revisions.first(where: { $0.status == "draft" })
    revisionPhase = .idle
  }

  func importSource(_ input: KnowledgeImportInput) async {
    var imported: KnowledgeImportResultDTO?
    await mutations.execute(
      action: { [dependencies] in
        imported = try await dependencies.importSource(input)
      },
      successMessage: "Knowledge source imported",
      fallbackError: "Could not import source",
      reload: { [weak self] in
        guard let self else { return }
        if imported?.draftRevision != nil {
          self.mode = .wiki
          self.selectedDocumentID = imported?.draftRevision?.documentId
        } else {
          self.mode = .sources
          self.selectedDocumentID = imported?.normalizedDocument.id
        }
        await self.load()
      }
    )
  }

  func reingestSelectedSource() async {
    guard let source = selectedSource else { return }
    var imported: KnowledgeImportResultDTO?
    await mutations.execute(
      action: { [dependencies] in
        imported = try await dependencies.reingestSource(source.id)
      },
      successMessage: "Knowledge source refreshed",
      fallbackError: "Could not refresh source",
      reload: { [weak self] in
        guard let self else { return }
        if let imported, imported.draftRevision != nil {
          self.mode = .wiki
          self.selectedDocumentID = imported.draftRevision?.documentId
        } else if let imported {
          self.selectedDocumentID = imported.normalizedDocument.id
        }
        await self.load()
      }
    )
  }

  func createLink() async {
    guard let selectedDocumentID else { return }
    let label = newLinkLabel.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !label.isEmpty else { return }
    let slug = newLinkSlug.trimmingCharacters(in: .whitespacesAndNewlines)
    let input = KnowledgeLinkCreateInput(
      sourceDocumentId: selectedDocumentID,
      targetSlug: slug.isEmpty ? nil : slug,
      targetLabel: label
    )

    await mutations.execute(
      action: { [dependencies] in
        _ = try await dependencies.createLink(input)
      },
      successMessage: "Link added",
      fallbackError: "Could not add link",
      reload: { [weak self] in
        guard let self else { return }
        self.newLinkLabel = ""
        self.newLinkSlug = ""
        if let selectedDocumentID = self.selectedDocumentID {
          await self.loadDocument(id: selectedDocumentID)
        }
      }
    )
  }

  func openKnowledgeDocument(id: String, kind: String? = nil) async {
    let resolvedMode = Mode.from(documentKind: kind ?? selectedDocumentDetail?.kind ?? mode.kind)
    if mode != resolvedMode {
      mode = resolvedMode
      await refreshListsOnly()
    } else if !documents.contains(where: { $0.id == id }) {
      await refreshListsOnly()
    }
    await loadDocument(id: id)
  }

  func openKnowledgeLink(_ link: KnowledgeLinkDTO) async {
    if let targetDocumentID = link.targetDocumentId {
      await openKnowledgeDocument(id: targetDocumentID)
      return
    }

    let query = (link.targetSlug?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank
      ?? link.targetLabel.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank) ?? ""
    guard !query.isEmpty else { return }

    do {
      let matches = try await dependencies.listDocuments(workspaceID, nil, query)
      if let exact = matches.first(where: { candidate in
        candidate.slug == link.targetSlug || candidate.title == link.targetLabel
      }) ?? matches.first {
        searchText = query
        documents = matches
        selectedDocumentID = exact.id
        await openKnowledgeDocument(id: exact.id, kind: exact.kind)
      }
    } catch {
      detailPhase = .failed(APIError.from(error))
    }
  }

  func dismissMutation() {
    mutations.dismiss()
  }

  private var trimmedSearchQuery: String? {
    let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func refreshListsOnly() async {
    do {
      async let sourcesTask = dependencies.listSources(workspaceID)
      async let convertersTask = dependencies.listConverters()
      async let documentsTask = dependencies.listDocuments(
        workspaceID, mode.kind, trimmedSearchQuery)
      async let compileJobsTask = dependencies.listCompileJobs(workspaceID)
      async let auditTask = dependencies.loadAudit(workspaceID)
      async let latestBetaRunTask = loadLatestBetaRun()
      let (
        loadedSources,
        loadedConverters,
        loadedDocuments,
        loadedCompileJobs,
        loadedAudit,
        loadedLatestBetaRun
      ) = try await (
        sourcesTask,
        convertersTask,
        documentsTask,
        compileJobsTask,
        auditTask,
        latestBetaRunTask
      )
      sources = loadedSources
      converters = loadedConverters.sorted { lhs, rhs in
        lhs.fallbackRank == rhs.fallbackRank ? lhs.id < rhs.id : lhs.fallbackRank < rhs.fallbackRank
      }
      latestBetaRun = loadedLatestBetaRun
      documents = loadedDocuments
      compileJobs = loadedCompileJobs.sorted { $0.updatedAt > $1.updatedAt }
      audit = loadedAudit
      loadPhase = documents.isEmpty && sources.isEmpty ? .empty : .loaded
    } catch {
      loadPhase = .failed(APIError.from(error))
    }
  }

  private func clearDocumentState() {
    selectedDocumentID = nil
    selectedDocumentDetail = nil
    revisions = []
    neighborhood = nil
    sourceSnapshots = []
    draftMarkdown = ""
    proposedRevision = nil
  }

  private func resetState() {
    sources = []
    sourceSnapshots = []
    converters = []
    latestBetaRun = nil
    documents = []
    compileJobs = []
    audit = nil
    searchText = ""
    newLinkLabel = ""
    newLinkSlug = ""
    loadPhase = .idle
    detailPhase = .idle
    revisionPhase = .idle
    linkPhase = .idle
    clearDocumentState()
    mutations.dismiss()
  }

  private func normalize(_ markdown: String) -> String {
    let replaced =
      markdown
      .replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
    return replaced.hasSuffix("\n") || replaced.isEmpty ? replaced : "\(replaced)\n"
  }

  private func loadLatestBetaRun() async throws -> KnowledgeBetaRunDetailDTO? {
    let runs = try await dependencies.listBetaRuns(workspaceID, 1)
    guard let latestRun = runs.first else { return nil }
    return try await dependencies.loadBetaRun(latestRun.id)
  }
}
