import Foundation

public struct DashboardSnapshot: Sendable {
    public let status: DaemonStatusDTO
    public let scheduler: SchedulerStatusDTO
    public let capabilities: EngineCapabilitiesDTO
    public let usage: UsageSummaryDTO
    public let securityAudit: SecurityAuditDTO?

    public init(
        status: DaemonStatusDTO,
        scheduler: SchedulerStatusDTO,
        capabilities: EngineCapabilitiesDTO,
        usage: UsageSummaryDTO,
        securityAudit: SecurityAuditDTO?
    ) {
        self.status = status
        self.scheduler = scheduler
        self.capabilities = capabilities
        self.usage = usage
        self.securityAudit = securityAudit
    }
}
