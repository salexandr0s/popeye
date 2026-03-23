import Foundation

public struct ReceiptRecordDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let runId: String
    public let jobId: String
    public let taskId: String
    public let workspaceId: String
    public let status: String // succeeded|failed|cancelled|abandoned
    public let summary: String
    public let details: String
    public let usage: ReceiptUsageDTO
    public let runtime: ReceiptRuntimeDTO?
    public let createdAt: String
}

public struct ReceiptUsageDTO: Codable, Sendable {
    public let provider: String
    public let model: String
    public let tokensIn: Int
    public let tokensOut: Int
    public let estimatedCostUsd: Double
}

public struct ReceiptRuntimeDTO: Codable, Sendable {
    public let projectId: String?
    public let profileId: String?
    public let execution: ReceiptExecutionDTO?
    public let contextReleases: ReceiptContextReleasesDTO?
    public let timeline: [ReceiptTimelineEventDTO]?
}

public struct ReceiptExecutionDTO: Codable, Sendable {
    public let mode: String
    public let sessionPolicy: String
    public let memoryScope: String
    public let recallScope: String
    public let filesystemPolicyClass: String
    public let contextReleasePolicy: String
    public let warnings: [String]
}

public struct ReceiptContextReleasesDTO: Codable, Sendable {
    public let totalReleases: Int
    public let totalTokenEstimate: Int
    public let byDomain: [String: ReceiptContextReleaseDomainDTO]
}

public struct ReceiptContextReleaseDomainDTO: Codable, Sendable {
    public let count: Int
    public let tokens: Int
}

public struct ReceiptTimelineEventDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let at: String
    public let kind: String // run|policy|approval|context_release|warning
    public let severity: String // info|warn|error
    public let code: String
    public let title: String
    public let detail: String
    public let source: String // run_event|security_audit|approval|context_release|receipt
    public let metadata: [String: String]
}
