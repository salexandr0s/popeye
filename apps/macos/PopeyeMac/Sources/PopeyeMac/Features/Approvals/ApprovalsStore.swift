import Foundation
import PopeyeAPI

@Observable @MainActor
final class ApprovalsStore {
    var approvals: [ApprovalDTO] = []
    var selectedId: String?
    var isLoading = false
    var searchText = ""
    var statusFilter: String?

    var filteredApprovals: [ApprovalDTO] {
        var result = approvals
        if let filter = statusFilter {
            result = result.filter { $0.status == filter }
        }
        if !searchText.isEmpty {
            result = result.filter {
                $0.id.localizedStandardContains(searchText)
                || $0.scope.localizedStandardContains(searchText)
                || $0.domain.localizedStandardContains(searchText)
                || $0.requestedBy.localizedStandardContains(searchText)
                || $0.status.localizedStandardContains(searchText)
            }
        }
        return result
    }

    var availableStatuses: [String] {
        Array(Set(approvals.map(\.status))).sorted()
    }

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let governanceService: GovernanceService
    private let client: ControlAPIClient

    init(client: ControlAPIClient) {
        self.client = client
        self.governanceService = GovernanceService(client: client)
    }

    var selectedApproval: ApprovalDTO? {
        guard let id = selectedId else { return nil }
        return approvals.first { $0.id == id }
    }

    var pendingCount: Int {
        approvals.count(where: { $0.status == "pending" })
    }

    var approvedCount: Int {
        approvals.count(where: { $0.status == "approved" })
    }

    var deniedCount: Int {
        approvals.count(where: { $0.status == "denied" })
    }

    func load() async {
        isLoading = true
        do {
            approvals = try await governanceService.loadApprovals()
        } catch {
            PopeyeLogger.refresh.error("Approvals load failed: \(error)")
        }
        isLoading = false
    }

    // MARK: - Mutations

    func resolveApproval(id: String, decision: String, reason: String? = nil) async {
        await mutations.execute(
            action: { [client] in _ = try await client.resolveApproval(id: id, decision: decision, reason: reason) },
            successMessage: "Approval \(decision)",
            fallbackError: "Resolve failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func dismissMutation() { mutations.dismiss() }

    static func canResolve(status: String) -> Bool {
        MutationEligibility.canResolveApproval(status: status)
    }
}
