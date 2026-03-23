import Foundation
import PopeyeAPI

@Observable @MainActor
final class ConnectionsStore {
    var connections: [ConnectionDTO] = []
    var selectedId: String?
    var isLoading = false

    private let connectionsService: ConnectionsService

    init(client: ControlAPIClient) {
        self.connectionsService = ConnectionsService(client: client)
    }

    var selectedConnection: ConnectionDTO? {
        guard let id = selectedId else { return nil }
        return connections.first { $0.id == id }
    }

    var healthyCount: Int {
        connections.count(where: { $0.health?.status == "healthy" })
    }

    var degradedCount: Int {
        connections.count(where: { $0.health?.status == "degraded" })
    }

    var errorCount: Int {
        connections.count(where: { $0.health?.status == "error" || $0.health?.status == "reauth_required" })
    }

    func load() async {
        isLoading = true
        do {
            connections = try await connectionsService.loadConnections()
        } catch {
            PopeyeLogger.refresh.error("Connections load failed: \(error)")
        }
        isLoading = false
    }
}
