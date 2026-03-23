import SwiftUI
import PopeyeAPI

struct HealthCard: View {
    let status: DaemonStatusDTO

    var body: some View {
        DashboardCard(
            label: "Status",
            value: status.ok ? "Healthy" : "Unhealthy",
            description: "Engine: \(status.engineKind)",
            valueColor: status.ok ? .green : .red
        )
    }
}
