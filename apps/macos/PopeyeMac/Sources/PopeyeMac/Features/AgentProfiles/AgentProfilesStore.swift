import Foundation
import PopeyeAPI

@Observable @MainActor
final class AgentProfilesStore {
    var profiles: [AgentProfileDTO] = []
    var selectedProfileId: String?
    var isLoading = false
    var searchText = ""

    var filteredProfiles: [AgentProfileDTO] {
        if searchText.isEmpty { return profiles }
        return profiles.filter {
            $0.name.localizedStandardContains(searchText)
            || $0.description.localizedStandardContains(searchText)
            || $0.mode.localizedStandardContains(searchText)
        }
    }

    var selectedProfile: AgentProfileDTO? {
        guard let id = selectedProfileId else { return nil }
        return profiles.first { $0.id == id }
    }

    private let systemService: SystemService
    private let client: ControlAPIClient

    init(client: ControlAPIClient) {
        self.client = client
        self.systemService = SystemService(client: client)
    }

    func load() async {
        isLoading = true
        do {
            profiles = try await systemService.loadAgentProfiles()
        } catch {
            PopeyeLogger.refresh.error("Agent profiles load failed: \(error)")
        }
        isLoading = false
    }
}
