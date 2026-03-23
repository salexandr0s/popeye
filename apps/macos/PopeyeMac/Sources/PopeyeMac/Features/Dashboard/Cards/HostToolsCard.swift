import SwiftUI
import PopeyeAPI

struct HostToolsCard: View {
    let capabilities: EngineCapabilitiesDTO

    var body: some View {
        DashboardCard(
            label: "Host Tools",
            value: capabilities.hostToolMode.replacing("_", with: " "),
            description: "Cancel: \(capabilities.cancellationMode.replacing("_", with: " "))"
        )
    }
}
