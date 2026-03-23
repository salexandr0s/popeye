import SwiftUI
import PopeyeAPI

struct SessionsCard: View {
    let capabilities: EngineCapabilitiesDTO

    var body: some View {
        DashboardCard(
            label: "Sessions",
            value: capabilities.persistentSessionSupport ? "Persistent" : "Ephemeral",
            description: capabilities.resumeBySessionRefSupport ? "Resume supported" : "No resume"
        )
    }
}
