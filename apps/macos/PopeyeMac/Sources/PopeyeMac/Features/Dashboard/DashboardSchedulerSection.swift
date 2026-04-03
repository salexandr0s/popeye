import SwiftUI
import PopeyeAPI

struct DashboardSchedulerSection: View {
    let snapshot: DashboardSnapshot

    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 200, maximum: 280)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Scheduler & Cost")
                .font(.headline)
                .foregroundStyle(.secondary)

            LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
                SchedulerCard(scheduler: snapshot.scheduler)
                ActiveLeasesCard(scheduler: snapshot.scheduler)
                TotalRunsCard(usage: snapshot.usage)
                EstimatedCostCard(usage: snapshot.usage)
            }
        }
    }
}
