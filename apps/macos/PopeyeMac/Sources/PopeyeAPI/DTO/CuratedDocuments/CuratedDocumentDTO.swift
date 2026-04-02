import Foundation

public struct CuratedDocumentSummaryDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let kind: String
    public let workspaceId: String
    public let projectId: String?
    public let title: String
    public let subtitle: String
    public let filePath: String
    public let writable: Bool
    public let critical: Bool
    public let exists: Bool
    public let updatedAt: String?

    public init(
        id: String,
        kind: String,
        workspaceId: String,
        projectId: String?,
        title: String,
        subtitle: String,
        filePath: String,
        writable: Bool,
        critical: Bool,
        exists: Bool,
        updatedAt: String?
    ) {
        self.id = id
        self.kind = kind
        self.workspaceId = workspaceId
        self.projectId = projectId
        self.title = title
        self.subtitle = subtitle
        self.filePath = filePath
        self.writable = writable
        self.critical = critical
        self.exists = exists
        self.updatedAt = updatedAt
    }
}

public struct CuratedDocumentRecordDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let kind: String
    public let workspaceId: String
    public let projectId: String?
    public let title: String
    public let subtitle: String
    public let filePath: String
    public let writable: Bool
    public let critical: Bool
    public let exists: Bool
    public let updatedAt: String?
    public let markdownText: String
    public let revisionHash: String?

    public init(
        id: String,
        kind: String,
        workspaceId: String,
        projectId: String?,
        title: String,
        subtitle: String,
        filePath: String,
        writable: Bool,
        critical: Bool,
        exists: Bool,
        updatedAt: String?,
        markdownText: String,
        revisionHash: String?
    ) {
        self.id = id
        self.kind = kind
        self.workspaceId = workspaceId
        self.projectId = projectId
        self.title = title
        self.subtitle = subtitle
        self.filePath = filePath
        self.writable = writable
        self.critical = critical
        self.exists = exists
        self.updatedAt = updatedAt
        self.markdownText = markdownText
        self.revisionHash = revisionHash
    }
}

public struct CuratedDocumentSaveProposalDTO: Codable, Sendable, Equatable {
    public let documentId: String
    public let status: String
    public let normalizedMarkdown: String
    public let diffPreview: String
    public let baseRevisionHash: String?
    public let currentRevisionHash: String?
    public let requiresExplicitConfirmation: Bool
    public let redactionApplied: Bool
    public let conflictMessage: String?
}

public struct CuratedDocumentApplyResultDTO: Codable, Sendable, Equatable {
    public let document: CuratedDocumentRecordDTO
    public let receipt: MutationReceiptDTO
}

public struct CuratedDocumentProposeSaveInput: Encodable, Sendable {
    public let markdownText: String
    public let baseRevisionHash: String?

    public init(markdownText: String, baseRevisionHash: String? = nil) {
        self.markdownText = markdownText
        self.baseRevisionHash = baseRevisionHash
    }
}

public struct CuratedDocumentApplySaveInput: Encodable, Sendable {
    public let markdownText: String
    public let baseRevisionHash: String?
    public let confirmedCriticalWrite: Bool

    public init(markdownText: String, baseRevisionHash: String? = nil, confirmedCriticalWrite: Bool = false) {
        self.markdownText = markdownText
        self.baseRevisionHash = baseRevisionHash
        self.confirmedCriticalWrite = confirmedCriticalWrite
    }
}
