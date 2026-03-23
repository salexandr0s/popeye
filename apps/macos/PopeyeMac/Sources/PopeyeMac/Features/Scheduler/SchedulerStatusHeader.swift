import SwiftUI
import PopeyeAPI

struct SchedulerStatusHeader: View {
    let scheduler: SchedulerStatusDTO

    var body: some View {
        HStack(spacing: 16) {
            statusIndicator
            Divider().frame(height: 40)
            metricCard(label: "Active Leases", value: "\(scheduler.activeLeases)")
            metricCard(label: "Active Runs", value: "\(scheduler.activeRuns)")
            heartbeatCard
        }
        .padding()
        .background(.background.secondary)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var statusIndicator: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(scheduler.running ? Color.green : Color.red)
                .frame(width: 10, height: 10)
            Text(scheduler.running ? "Running" : "Stopped")
                .font(.headline)
        }
        .frame(minWidth: 100)
    }

    private func metricCard(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title2)
                .fontWeight(.semibold)
                .monospacedDigit()
        }
    }

    @ViewBuilder
    private var heartbeatCard: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Next Heartbeat")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let next = scheduler.nextHeartbeatDueAt {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    Text(DateFormatting.formatRelativeTime(next))
                        .font(.callout)
                        .monospacedDigit()
                }
            } else {
                Text("—")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}
