import SwiftUI
import PopeyeAPI

struct UptimeCard: View {
    let status: DaemonStatusDTO

    var body: some View {
        DashboardCard(
            label: "Uptime",
            value: DurationFormatting.formatUptime(since: status.startedAt),
            description: DateFormatting.formatAbsoluteTime(status.startedAt)
        )
    }
}
