import SwiftUI
import PopeyeAPI

struct SchedulerCard: View {
    let scheduler: SchedulerStatusDTO

    var body: some View {
        DashboardCard(
            label: "Scheduler",
            value: scheduler.running ? "Running" : "Stopped",
            description: nextHeartbeatDescription,
            valueColor: scheduler.running ? .green : .red
        )
    }

    private var nextHeartbeatDescription: String? {
        guard let next = scheduler.nextHeartbeatDueAt else { return nil }
        return "Next: \(DateFormatting.formatRelativeTime(next))"
    }
}
