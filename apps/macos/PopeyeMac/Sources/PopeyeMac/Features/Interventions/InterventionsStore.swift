import Foundation
import PopeyeAPI

@Observable @MainActor
final class InterventionsStore {
    var interventions: [InterventionDTO] = []
    var selectedId: String?
    var isLoading = false
    var searchText = ""
    var statusFilter: String?

    var filteredInterventions: [InterventionDTO] {
        var result = interventions
        if let filter = statusFilter {
            result = result.filter { $0.status == filter }
        }
        if !searchText.isEmpty {
            result = result.filter {
                $0.id.localizedStandardContains(searchText)
                || $0.code.localizedStandardContains(searchText)
                || $0.reason.localizedStandardContains(searchText)
                || $0.status.localizedStandardContains(searchText)
            }
        }
        return result
    }

    var availableStatuses: [String] {
        Array(Set(interventions.map(\.status))).sorted()
    }

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let governanceService: GovernanceService
    private let client: ControlAPIClient

    init(client: ControlAPIClient) {
        self.client = client
        self.governanceService = GovernanceService(client: client)
    }

    var selectedIntervention: InterventionDTO? {
        guard let id = selectedId else { return nil }
        return interventions.first { $0.id == id }
    }

    var openCount: Int {
        interventions.count(where: { $0.status == "open" })
    }

    var resolvedCount: Int {
        interventions.count(where: { $0.status == "resolved" })
    }

    func load() async {
        isLoading = true
        do {
            interventions = try await governanceService.loadInterventions()
        } catch {
            PopeyeLogger.refresh.error("Interventions load failed: \(error)")
        }
        isLoading = false
    }

    // MARK: - Mutations

    func resolveIntervention(id: String, note: String? = nil) async {
        await mutations.execute(
            action: { [client] in _ = try await client.resolveIntervention(id: id, note: note) },
            successMessage: "Intervention resolved",
            fallbackError: "Resolve failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func dismissMutation() { mutations.dismiss() }

    static func canResolve(status: String) -> Bool {
        MutationEligibility.canResolveIntervention(status: status)
    }
}
