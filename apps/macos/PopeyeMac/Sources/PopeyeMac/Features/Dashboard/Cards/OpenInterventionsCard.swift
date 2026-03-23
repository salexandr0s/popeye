import SwiftUI
import PopeyeAPI

struct OpenInterventionsCard: View {
    let status: DaemonStatusDTO

    var body: some View {
        DashboardCard(
            label: "Open Interventions",
            value: "\(status.openInterventions)",
            description: status.openInterventions > 0 ? "Needs attention" : nil,
            valueColor: status.openInterventions > 0 ? .orange : .primary
        )
    }
}
