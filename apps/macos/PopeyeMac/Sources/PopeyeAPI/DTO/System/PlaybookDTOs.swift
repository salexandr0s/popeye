import Foundation

public struct PlaybookEffectivenessDTO: Codable, Sendable, Equatable {
    public let useCount30d: Int
    public let succeededRuns30d: Int
    public let failedRuns30d: Int
    public let intervenedRuns30d: Int
    public let successRate30d: Double
    public let failureRate30d: Double
    public let interventionRate30d: Double
    public let lastUsedAt: String?
    public let lastUpdatedAt: String
}

public struct PlaybookRecordDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { recordId }

    public let recordId: String
    public let playbookId: String
    public let scope: String
    public let workspaceId: String?
    public let projectId: String?
    public let title: String
    public let status: String
    public let allowedProfileIds: [String]
    public let filePath: String
    public let currentRevisionHash: String
    public let createdAt: String
    public let updatedAt: String
    public let effectiveness: PlaybookEffectivenessDTO?
}

public struct PlaybookDetailDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { recordId }

    public let recordId: String
    public let playbookId: String
    public let scope: String
    public let workspaceId: String?
    public let projectId: String?
    public let title: String
    public let status: String
    public let allowedProfileIds: [String]
    public let filePath: String
    public let currentRevisionHash: String
    public let createdAt: String
    public let updatedAt: String
    public let effectiveness: PlaybookEffectivenessDTO?
    public let body: String
    public let markdownText: String
    public let indexedMemoryId: String?
}

public struct PlaybookRevisionDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { revisionHash }

    public let playbookRecordId: String
    public let revisionHash: String
    public let title: String
    public let status: String
    public let allowedProfileIds: [String]
    public let filePath: String
    public let contentHash: String
    public let markdownText: String
    public let createdAt: String
    public let current: Bool
}

public struct PlaybookUsageRunDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { runId }

    public let runId: String
    public let taskId: String
    public let jobId: String
    public let runState: String
    public let startedAt: String
    public let finishedAt: String?
    public let interventionCount: Int
    public let receiptId: String?
}

public struct PlaybookStaleCandidateDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { recordId }

    public let recordId: String
    public let title: String
    public let scope: String
    public let currentRevisionHash: String
    public let lastUsedAt: String?
    public let useCount30d: Int
    public let failedRuns30d: Int
    public let interventions30d: Int
    public let lastProposalAt: String?
    public let indexedMemoryId: String?
    public let reasons: [String]
}

public struct PlaybookProposalEvidenceMetricsDTO: Codable, Sendable, Equatable {
    public let useCount30d: Int
    public let failedRuns30d: Int
    public let interventions30d: Int
}

public struct PlaybookProposalEvidenceDTO: Codable, Sendable, Equatable {
    public let runIds: [String]
    public let interventionIds: [String]
    public let lastProblemAt: String?
    public let metrics30d: PlaybookProposalEvidenceMetricsDTO
    public let suggestedPatchNote: String
}

public struct PlaybookProposalDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let kind: String
    public let status: String
    public let targetRecordId: String?
    public let baseRevisionHash: String?
    public let playbookId: String
    public let scope: String
    public let workspaceId: String?
    public let projectId: String?
    public let title: String
    public let proposedStatus: String
    public let allowedProfileIds: [String]
    public let summary: String
    public let body: String
    public let markdownText: String
    public let diffPreview: String
    public let contentHash: String
    public let revisionHash: String
    public let scanVerdict: String
    public let scanMatchedRules: [String]
    public let sourceRunId: String?
    public let proposedBy: String
    public let evidence: PlaybookProposalEvidenceDTO?
    public let reviewedBy: String?
    public let reviewedAt: String?
    public let reviewNote: String?
    public let appliedRecordId: String?
    public let appliedRevisionHash: String?
    public let appliedAt: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct PlaybookProposalReviewInput: Encodable, Sendable, Equatable {
    public let decision: String
    public let reviewedBy: String
    public let note: String?

    public init(decision: String, reviewedBy: String, note: String? = nil) {
        self.decision = decision
        self.reviewedBy = reviewedBy
        self.note = note
    }
}

public struct PlaybookProposalSubmitReviewInput: Encodable, Sendable, Equatable {
    public let submittedBy: String

    public init(submittedBy: String) {
        self.submittedBy = submittedBy
    }
}

public struct PlaybookProposalApplyInput: Encodable, Sendable, Equatable {
    public let appliedBy: String

    public init(appliedBy: String) {
        self.appliedBy = appliedBy
    }
}

public struct PlaybookLifecycleActionInput: Encodable, Sendable, Equatable {
    public let updatedBy: String

    public init(updatedBy: String) {
        self.updatedBy = updatedBy
    }
}
