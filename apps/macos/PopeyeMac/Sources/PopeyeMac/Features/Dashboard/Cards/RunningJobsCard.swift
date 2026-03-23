import SwiftUI
import PopeyeAPI

struct RunningJobsCard: View {
    let status: DaemonStatusDTO

    var body: some View {
        DashboardCard(
            label: "Running Jobs",
            value: "\(status.runningJobs)",
            description: "+\(status.queuedJobs) queued"
        )
    }
}
