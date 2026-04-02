import Foundation

public struct FileRootDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let workspaceId: String
    public let label: String
    public let rootPath: String
    public let permission: String
    public let filePatterns: [String]
    public let excludePatterns: [String]
    public let maxFileSizeBytes: Int
    public let enabled: Bool
    public let lastIndexedAt: String?
    public let lastIndexedCount: Int
    public let createdAt: String
    public let updatedAt: String
}

public struct FileDocumentDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let fileRootId: String
    public let relativePath: String
    public let contentHash: String
    public let sizeBytes: Int
    public let memoryId: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct FileSearchResultDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { documentId }
    public let documentId: String
    public let fileRootId: String
    public let relativePath: String
    public let memoryId: String?
    public let score: Double
    public let snippet: String
}

public struct FileSearchResponseDTO: Codable, Sendable, Equatable {
    public let query: String
    public let results: [FileSearchResultDTO]
    public let totalCandidates: Int
}

public struct FileIndexResultDTO: Codable, Sendable, Equatable {
    public let rootId: String
    public let indexed: Int
    public let updated: Int
    public let skipped: Int
    public let stale: Int
    public let errors: [String]
}

public struct FileWriteIntentDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let fileRootId: String
    public let filePath: String
    public let intentType: String
    public let diffPreview: String
    public let status: String
    public let runId: String?
    public let approvalId: String?
    public let receiptId: String?
    public let createdAt: String
    public let reviewedAt: String?
}

public struct FileRootRegistrationInput: Encodable, Sendable {
    public let workspaceId: String
    public let label: String
    public let rootPath: String
    public let permission: String
    public let filePatterns: [String]
    public let excludePatterns: [String]
    public let maxFileSizeBytes: Int

    public init(
        workspaceId: String,
        label: String,
        rootPath: String,
        permission: String = "index",
        filePatterns: [String] = ["**/*.md", "**/*.txt"],
        excludePatterns: [String] = [],
        maxFileSizeBytes: Int = 1_048_576
    ) {
        self.workspaceId = workspaceId
        self.label = label
        self.rootPath = rootPath
        self.permission = permission
        self.filePatterns = filePatterns
        self.excludePatterns = excludePatterns
        self.maxFileSizeBytes = maxFileSizeBytes
    }
}

public struct FileRootUpdateInput: Encodable, Sendable {
    public let label: String?
    public let permission: String?
    public let filePatterns: [String]?
    public let excludePatterns: [String]?
    public let maxFileSizeBytes: Int?
    public let enabled: Bool?

    public init(
        label: String? = nil,
        permission: String? = nil,
        filePatterns: [String]? = nil,
        excludePatterns: [String]? = nil,
        maxFileSizeBytes: Int? = nil,
        enabled: Bool? = nil
    ) {
        self.label = label
        self.permission = permission
        self.filePatterns = filePatterns
        self.excludePatterns = excludePatterns
        self.maxFileSizeBytes = maxFileSizeBytes
        self.enabled = enabled
    }
}

public struct FileWriteIntentReviewInput: Encodable, Sendable {
    public let action: String
    public let reason: String?

    public init(action: String, reason: String? = nil) {
        self.action = action
        self.reason = reason
    }
}
