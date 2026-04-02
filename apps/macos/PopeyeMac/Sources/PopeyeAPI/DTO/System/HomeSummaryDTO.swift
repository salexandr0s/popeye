import Foundation

public struct HomeSetupSummaryDTO: Codable, Sendable, Equatable {
    public let supportedProviderCount: Int
    public let healthyProviderCount: Int
    public let attentionProviderCount: Int
    public let telegramStatusLabel: String
    public let telegramEffectiveWorkspaceId: String?
}

public struct HomeSummaryDTO: Codable, Sendable {
    public let workspaceId: String
    public let workspaceName: String?
    public let status: DaemonStatusDTO
    public let scheduler: SchedulerStatusDTO
    public let capabilities: EngineCapabilitiesDTO
    public let setup: HomeSetupSummaryDTO
    public let automationAttention: [AutomationRecordDTO]
    public let automationDueSoon: [AutomationRecordDTO]
    public let upcomingEvents: [CalendarEventDTO]
    public let calendarDigest: CalendarDigestDTO?
    public let upcomingTodos: [TodoItemDTO]
    public let todoDigest: TodoDigestDTO?
    public let recentMemories: [MemoryRecordDTO]
    public let controlChanges: [MutationReceiptDTO]
    public let pendingApprovalCount: Int
}
