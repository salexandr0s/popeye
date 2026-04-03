import SwiftUI
import PopeyeAPI

struct DashboardHealthSection: View {
    let snapshot: DashboardSnapshot

    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 200, maximum: 280)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Daemon Health")
                .font(.headline)
                .foregroundStyle(.secondary)

            LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
                HealthCard(status: snapshot.status)
                UptimeCard(status: snapshot.status)
                RunningJobsCard(status: snapshot.status)
                OpenInterventionsCard(status: snapshot.status)
            }
        }
    }
}
