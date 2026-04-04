import Foundation

public struct KnowledgeSourceDTO: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let workspaceId: String
  public let knowledgeRootId: String
  public let sourceType: String
  public let title: String
  public let originalUri: String?
  public let originalPath: String?
  public let originalFileName: String?
  public let originalMediaType: String?
  public let adapter: String
  public let fallbackUsed: Bool
  public let status: String
  public let contentHash: String
  public let assetStatus: String
  public let latestOutcome: String
  public let conversionWarnings: [String]
  public let createdAt: String
  public let updatedAt: String
}

public struct KnowledgeDocumentDTO: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let workspaceId: String
  public let knowledgeRootId: String
  public let sourceId: String?
  public let kind: String
  public let title: String
  public let slug: String
  public let relativePath: String
  public let revisionHash: String?
  public let status: String
  public let createdAt: String
  public let updatedAt: String
}

public struct KnowledgeDocumentDetailDTO: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let workspaceId: String
  public let knowledgeRootId: String
  public let sourceId: String?
  public let kind: String
  public let title: String
  public let slug: String
  public let relativePath: String
  public let revisionHash: String?
  public let status: String
  public let createdAt: String
  public let updatedAt: String
  public let markdownText: String
  public let exists: Bool
  public let sourceIds: [String]
}

public struct KnowledgeDocumentRevisionDTO: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let documentId: String
  public let workspaceId: String
  public let status: String
  public let sourceKind: String
  public let sourceId: String?
  public let proposedTitle: String?
  public let proposedMarkdown: String
  public let diffPreview: String
  public let baseRevisionHash: String?
  public let createdAt: String
  public let appliedAt: String?
}

public struct KnowledgeLinkDTO: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let workspaceId: String
  public let sourceDocumentId: String
  public let targetDocumentId: String?
  public let targetSlug: String?
  public let targetLabel: String
  public let linkKind: String
  public let linkStatus: String
  public let confidence: Double
  public let createdAt: String
  public let updatedAt: String
}

public struct KnowledgeNeighborhoodDTO: Codable, Sendable, Equatable {
  public let document: KnowledgeDocumentDTO
  public let incoming: [KnowledgeLinkDTO]
  public let outgoing: [KnowledgeLinkDTO]
  public let relatedDocuments: [KnowledgeDocumentDTO]
}

public struct KnowledgeCompileJobDTO: Codable, Sendable, Identifiable, Equatable {
  public let id: String
  public let workspaceId: String
  public let sourceId: String?
  public let targetDocumentId: String?
  public let status: String
  public let summary: String
  public let warnings: [String]
  public let createdAt: String
  public let updatedAt: String
}

public struct KnowledgeAuditDTO: Codable, Sendable, Equatable {
  public let totalSources: Int
  public let totalDocuments: Int
  public let totalDraftRevisions: Int
  public let unresolvedLinks: Int
  public let brokenLinks: Int
  public let failedConversions: Int
  public let degradedSources: Int
  public let warningSources: Int
  public let assetLocalizationFailures: Int
  public let lastCompileAt: String?
}

public struct KnowledgeImportResultDTO: Codable, Sendable, Equatable {
  public let source: KnowledgeSourceDTO
  public let normalizedDocument: KnowledgeDocumentDTO
  public let compileJob: KnowledgeCompileJobDTO
  public let draftRevision: KnowledgeDocumentRevisionDTO?
  public let outcome: String
}

public struct KnowledgeRevisionApplyResultDTO: Codable, Sendable, Equatable {
  public let revision: KnowledgeDocumentRevisionDTO
  public let document: KnowledgeDocumentDetailDTO
  public let receipt: MutationReceiptDTO
}

public struct KnowledgeRevisionRejectResultDTO: Codable, Sendable, Equatable {
  public let revision: KnowledgeDocumentRevisionDTO
  public let document: KnowledgeDocumentDetailDTO
  public let receipt: MutationReceiptDTO
}

public struct KnowledgeConverterAvailabilityDTO: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let status: String
  public let provenance: String
  public let details: String
  public let version: String?
  public let lastCheckedAt: String
  public let installHint: String?
  public let usedFor: [String]
  public let fallbackRank: Int
}

public struct KnowledgeSourceSnapshotDTO: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let sourceId: String
  public let workspaceId: String
  public let contentHash: String
  public let adapter: String
  public let fallbackUsed: Bool
  public let status: String
  public let assetStatus: String
  public let outcome: String
  public let conversionWarnings: [String]
  public let createdAt: String
}

public struct KnowledgeBetaReportRowDTO: Codable, Sendable, Equatable {
  public let label: String
  public let title: String
  public let sourceType: String
  public let outcome: String
  public let sourceId: String?
  public let adapter: String?
  public let status: String?
  public let assetStatus: String?
  public let draftRevisionId: String?
  public let error: String?
}

public struct KnowledgeBetaGateCheckDTO: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let label: String
  public let passed: Bool
  public let details: String
}

public struct KnowledgeBetaGateDTO: Codable, Sendable, Equatable {
  public let status: String
  public let minImportSuccessRate: Double
  public let actualImportSuccessRate: Double
  public let maxHardFailures: Int
  public let actualHardFailures: Int
  public let expectedReingestChecks: Int
  public let failedExpectedReingestChecks: Int
  public let checks: [KnowledgeBetaGateCheckDTO]
}

public struct KnowledgeBetaRunRecordDTO: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let workspaceId: String
  public let manifestPath: String?
  public let importCount: Int
  public let reingestCount: Int
  public let hardFailureCount: Int
  public let importSuccessRate: Double
  public let gateStatus: String
  public let createdAt: String
}

public struct KnowledgeBetaRunDetailDTO: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let workspaceId: String
  public let manifestPath: String?
  public let importCount: Int
  public let reingestCount: Int
  public let hardFailureCount: Int
  public let importSuccessRate: Double
  public let gateStatus: String
  public let createdAt: String
  public let reportMarkdown: String
  public let imports: [KnowledgeBetaReportRowDTO]
  public let reingests: [KnowledgeBetaReportRowDTO]
  public let converters: [KnowledgeConverterAvailabilityDTO]
  public let audit: KnowledgeAuditDTO
  public let gate: KnowledgeBetaGateDTO
}

public struct KnowledgeImportInput: Encodable, Sendable {
  public let workspaceId: String
  public let sourceType: String
  public let title: String
  public let sourceUri: String?
  public let sourcePath: String?
  public let sourceText: String?

  public init(
    workspaceId: String,
    sourceType: String,
    title: String,
    sourceUri: String? = nil,
    sourcePath: String? = nil,
    sourceText: String? = nil
  ) {
    self.workspaceId = workspaceId
    self.sourceType = sourceType
    self.title = title
    self.sourceUri = sourceUri
    self.sourcePath = sourcePath
    self.sourceText = sourceText
  }
}

public struct KnowledgeRevisionProposalInput: Encodable, Sendable {
  public let title: String?
  public let markdownText: String
  public let baseRevisionHash: String?

  public init(title: String? = nil, markdownText: String, baseRevisionHash: String? = nil) {
    self.title = title
    self.markdownText = markdownText
    self.baseRevisionHash = baseRevisionHash
  }
}

public struct KnowledgeRevisionApplyInput: Encodable, Sendable {
  public let approved: Bool

  public init(approved: Bool = true) {
    self.approved = approved
  }
}

public struct KnowledgeLinkCreateInput: Encodable, Sendable {
  public let sourceDocumentId: String
  public let targetDocumentId: String?
  public let targetSlug: String?
  public let targetLabel: String
  public let linkKind: String

  public init(
    sourceDocumentId: String,
    targetDocumentId: String? = nil,
    targetSlug: String? = nil,
    targetLabel: String,
    linkKind: String = "related"
  ) {
    self.sourceDocumentId = sourceDocumentId
    self.targetDocumentId = targetDocumentId
    self.targetSlug = targetSlug
    self.targetLabel = targetLabel
    self.linkKind = linkKind
  }
}
