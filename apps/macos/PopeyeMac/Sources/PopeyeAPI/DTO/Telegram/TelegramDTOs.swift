import Foundation

// MARK: - TelegramDeliveryDTO

/// Telegram delivery record — tracks a message delivery to a Telegram chat.
/// Matches TelegramDeliveryRecordSchema in @popeye/contracts.
public struct TelegramDeliveryDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let workspaceId: String
    public let chatId: String
    public let telegramMessageId: Int
    public let messageIngressId: String
    public let taskId: String?
    public let jobId: String?
    public let runId: String?
    public let status: String // pending|sending|sent|uncertain|abandoned
    public let sentAt: String?
    public let sentTelegramMessageId: Int?
    public let createdAt: String
    public let updatedAt: String
}

// MARK: - TelegramSendAttemptDTO

/// A single send attempt for a Telegram delivery.
/// Matches TelegramSendAttemptRecordSchema in @popeye/contracts.
public struct TelegramSendAttemptDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let deliveryId: String
    public let workspaceId: String
    public let attemptNumber: Int
    public let startedAt: String
    public let finishedAt: String?
    public let runId: String?
    public let contentHash: String
    public let outcome: String // sent|retryable_failure|permanent_failure|ambiguous
    public let sentTelegramMessageId: Int?
    public let errorSummary: String?
    public let source: String
    public let createdAt: String
}

// MARK: - TelegramResolutionDTO

/// Operator resolution of a Telegram delivery (confirm, resend, or abandon).
/// Matches TelegramDeliveryResolutionRecordSchema in @popeye/contracts.
public struct TelegramResolutionDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let deliveryId: String
    public let workspaceId: String
    public let action: String // confirm_sent|resend|abandon
    public let interventionId: String?
    public let operatorNote: String?
    public let sentTelegramMessageId: Int?
    public let previousStatus: String
    public let newStatus: String
    public let createdAt: String
}

// MARK: - TelegramRelayCheckpointDTO

/// Relay checkpoint tracking the last acknowledged Telegram update.
/// Matches TelegramRelayCheckpointSchema in @popeye/contracts.
public struct TelegramRelayCheckpointDTO: Codable, Sendable {
    public let relayKey: String
    public let workspaceId: String
    public let lastAcknowledgedUpdateId: Int
    public let updatedAt: String
}

// MARK: - TelegramDeliveryResolveInput

/// Request body for resolving a Telegram delivery.
/// Matches TelegramDeliveryResolutionRequestSchema in @popeye/contracts (minus workspaceId path param).
public struct TelegramDeliveryResolveInput: Codable, Sendable {
    public let workspaceId: String
    public let action: String // confirm_sent|resend|abandon
    public let operatorNote: String?
    public let sentTelegramMessageId: Int?

    public init(workspaceId: String = "default", action: String, operatorNote: String? = nil, sentTelegramMessageId: Int? = nil) {
        self.workspaceId = workspaceId
        self.action = action
        self.operatorNote = operatorNote
        self.sentTelegramMessageId = sentTelegramMessageId
    }
}

// MARK: - TelegramDeliveryDetailSnapshot

/// Aggregate snapshot for a delivery detail view: the delivery plus its resolutions and attempts.
public struct TelegramDeliveryDetailSnapshot: Sendable {
    public let delivery: TelegramDeliveryDTO
    public let resolutions: [TelegramResolutionDTO]
    public let attempts: [TelegramSendAttemptDTO]
}
