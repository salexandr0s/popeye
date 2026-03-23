import Foundation

public struct DashboardSnapshot: Sendable {
    public let status: DaemonStatusDTO
    public let scheduler: SchedulerStatusDTO
    public let capabilities: EngineCapabilitiesDTO
    public let usage: UsageSummaryDTO
    public let securityAudit: SecurityAuditDTO?
    public let memoryAudit: MemoryAuditDTO?

    public init(
        status: DaemonStatusDTO,
        scheduler: SchedulerStatusDTO,
        capabilities: EngineCapabilitiesDTO,
        usage: UsageSummaryDTO,
        securityAudit: SecurityAuditDTO?,
        memoryAudit: MemoryAuditDTO? = nil
    ) {
        self.status = status
        self.scheduler = scheduler
        self.capabilities = capabilities
        self.usage = usage
        self.securityAudit = securityAudit
        self.memoryAudit = memoryAudit
    }
}
