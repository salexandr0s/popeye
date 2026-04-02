import Foundation

public struct FilesService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadRoots(workspaceId: String? = nil) async throws -> [FileRootDTO] {
        try await client.listFileRoots(workspaceId: workspaceId)
    }

    public func loadRoot(id: String) async throws -> FileRootDTO {
        try await client.getFileRoot(id: id)
    }

    public func search(query: String, rootId: String? = nil, workspaceId: String? = nil, limit: Int = 10) async throws -> FileSearchResponseDTO {
        try await client.searchFiles(query: query, rootId: rootId, workspaceId: workspaceId, limit: limit)
    }

    public func loadDocument(id: String) async throws -> FileDocumentDTO {
        try await client.getFileDocument(id: id)
    }

    public func loadWriteIntents(rootId: String? = nil, status: String? = nil) async throws -> [FileWriteIntentDTO] {
        try await client.listFileWriteIntents(rootId: rootId, status: status)
    }

    public func loadWriteIntent(id: String) async throws -> FileWriteIntentDTO {
        try await client.getFileWriteIntent(id: id)
    }

    public func createRoot(input: FileRootRegistrationInput) async throws -> FileRootDTO {
        try await client.createFileRoot(input: input)
    }

    public func updateRoot(id: String, input: FileRootUpdateInput) async throws -> FileRootDTO {
        try await client.updateFileRoot(id: id, input: input)
    }

    public func deleteRoot(id: String) async throws {
        _ = try await client.deleteFileRoot(id: id)
    }

    public func reindexRoot(id: String) async throws -> FileIndexResultDTO {
        try await client.reindexFileRoot(id: id)
    }

    public func reviewWriteIntent(id: String, action: String, reason: String? = nil) async throws -> FileWriteIntentDTO {
        try await client.reviewFileWriteIntent(id: id, input: FileWriteIntentReviewInput(action: action, reason: reason))
    }
}
