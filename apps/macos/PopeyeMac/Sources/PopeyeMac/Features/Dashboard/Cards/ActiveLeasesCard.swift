import SwiftUI
import PopeyeAPI

struct ActiveLeasesCard: View {
    let scheduler: SchedulerStatusDTO

    var body: some View {
        DashboardCard(
            label: "Active Leases",
            value: "\(scheduler.activeLeases)"
        )
    }
}
