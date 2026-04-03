import SwiftUI
import PopeyeAPI

struct HomeStatusSummarySection: View {
    let summary: HomeSummaryDTO?
    let pendingApprovalCount: Int

    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 180, maximum: 260)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
            DashboardCard(
                label: "Daemon",
                value: summary?.status.ok == true ? "Healthy" : "Needs attention",
                description: summary?.capabilities.engineKind.uppercased(),
                valueColor: summary?.status.ok == true ? .green : .orange
            )
            DashboardCard(
                label: "Scheduler",
                value: summary?.scheduler.running == true ? "Running" : "Stopped",
                description: summary?.scheduler.nextHeartbeatDueAt.map(DateFormatting.formatRelativeTime) ?? "No heartbeat scheduled",
                valueColor: summary?.scheduler.running == true ? .green : .orange
            )
            DashboardCard(
                label: "Interventions",
                value: "\(summary?.status.openInterventions ?? 0)",
                description: (summary?.status.openInterventions ?? 0) == 0 ? "No open interventions" : "Operator action needed",
                valueColor: (summary?.status.openInterventions ?? 0) == 0 ? .green : .orange
            )
            DashboardCard(
                label: "Approvals",
                value: "\(pendingApprovalCount)",
                description: pendingApprovalCount == 0 ? "No pending approvals" : "Waiting for review",
                valueColor: pendingApprovalCount == 0 ? .green : .orange
            )
        }
    }
}
