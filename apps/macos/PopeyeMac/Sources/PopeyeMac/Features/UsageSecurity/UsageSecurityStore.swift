import Foundation
import PopeyeAPI

@Observable @MainActor
final class UsageSecurityStore {
    var usage: UsageSummaryDTO?
    var securityAudit: SecurityAuditDTO?
    var controlChanges: [MutationReceiptDTO] = []
    var isLoading = false

    private let systemService: SystemService
    private let governanceService: GovernanceService

    init(client: ControlAPIClient) {
        self.systemService = SystemService(client: client)
        self.governanceService = GovernanceService(client: client)
    }

    func load() async {
        isLoading = true
        do {
            async let snapshot = systemService.loadDashboardSnapshot()
            async let receipts = governanceService.loadMutationReceipts(limit: 8)
            let loadedSnapshot = try await snapshot
            usage = loadedSnapshot.usage
            securityAudit = loadedSnapshot.securityAudit
            controlChanges = (try? await receipts) ?? []
        } catch {
            PopeyeLogger.refresh.error("Usage/Security load failed: \(error)")
        }
        isLoading = false
    }
}
