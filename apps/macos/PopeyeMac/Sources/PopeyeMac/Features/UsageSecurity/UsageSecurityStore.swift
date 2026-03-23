import Foundation
import PopeyeAPI

@Observable @MainActor
final class UsageSecurityStore {
    var usage: UsageSummaryDTO?
    var securityAudit: SecurityAuditDTO?
    var isLoading = false

    private let systemService: SystemService

    init(client: ControlAPIClient) {
        self.systemService = SystemService(client: client)
    }

    func load() async {
        isLoading = true
        do {
            let snap = try await systemService.loadDashboardSnapshot()
            usage = snap.usage
            securityAudit = snap.securityAudit
        } catch {
            PopeyeLogger.refresh.error("Usage/Security load failed: \(error)")
        }
        isLoading = false
    }
}
