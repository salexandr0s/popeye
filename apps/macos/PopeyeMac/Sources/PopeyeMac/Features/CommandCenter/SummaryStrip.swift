import SwiftUI
import PopeyeAPI

struct SummaryStrip: View {
    let store: CommandCenterStore

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 6)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            DashboardCard(
                label: "Active Runs",
                value: "\(store.activeRuns.count)",
                description: schedulerNote,
                valueColor: store.activeRuns.isEmpty ? .secondary : .blue
            )
            DashboardCard(
                label: "Queued Jobs",
                value: "\(queuedCount)",
                valueColor: queuedCount > 0 ? .primary : .secondary
            )
            DashboardCard(
                label: "Blocked Jobs",
                value: "\(store.blockedJobs.count)",
                valueColor: store.blockedJobs.isEmpty ? .secondary : .orange
            )
            DashboardCard(
                label: "Open Interventions",
                value: "\(store.openInterventions.count)",
                valueColor: store.openInterventions.isEmpty ? .secondary : .orange
            )
            DashboardCard(
                label: "Estimated Cost",
                value: costString,
                description: tokenNote
            )
            DashboardCard(
                label: "Recent Failures",
                value: "\(store.recentFailures.count)",
                valueColor: store.recentFailures.isEmpty ? .secondary : .red
            )
        }
    }

    private var queuedCount: Int {
        store.jobs.count(where: { $0.status == "queued" })
    }

    private var schedulerNote: String? {
        guard let sched = store.scheduler else { return nil }
        return sched.running ? "Scheduler running" : "Scheduler paused"
    }

    private var costString: String {
        guard let usage = store.usage else { return "--" }
        return CurrencyFormatting.formatCostUSD(usage.estimatedCostUsd)
    }

    private var tokenNote: String? {
        guard let usage = store.usage else { return nil }
        let tokIn = IdentifierFormatting.formatTokenCount(usage.tokensIn)
        let tokOut = IdentifierFormatting.formatTokenCount(usage.tokensOut)
        return "\(tokIn) in / \(tokOut) out"
    }
}
