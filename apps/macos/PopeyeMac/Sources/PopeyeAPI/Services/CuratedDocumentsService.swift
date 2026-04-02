import Foundation

public struct CuratedDocumentsService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadDocuments(workspaceId: String) async throws -> [CuratedDocumentSummaryDTO] {
        try await client.listCuratedDocuments(workspaceId: workspaceId)
    }

    public func loadDocument(id: String) async throws -> CuratedDocumentRecordDTO {
        try await client.getCuratedDocument(id: id)
    }

    public func proposeSave(id: String, markdownText: String, baseRevisionHash: String?) async throws -> CuratedDocumentSaveProposalDTO {
        try await client.proposeCuratedDocumentSave(
            id: id,
            input: CuratedDocumentProposeSaveInput(markdownText: markdownText, baseRevisionHash: baseRevisionHash)
        )
    }

    public func applySave(
        id: String,
        markdownText: String,
        baseRevisionHash: String?,
        confirmedCriticalWrite: Bool
    ) async throws -> CuratedDocumentApplyResultDTO {
        try await client.applyCuratedDocumentSave(
            id: id,
            input: CuratedDocumentApplySaveInput(
                markdownText: markdownText,
                baseRevisionHash: baseRevisionHash,
                confirmedCriticalWrite: confirmedCriticalWrite
            )
        )
    }
}
