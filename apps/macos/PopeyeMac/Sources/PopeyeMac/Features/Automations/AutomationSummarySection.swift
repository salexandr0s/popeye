import SwiftUI
import PopeyeAPI

struct AutomationSummarySection: View {
    let detail: AutomationDetailDTO

    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 180, maximum: 260)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
            DashboardCard(
                label: "Last Success",
                value: detail.lastSuccessAt.map(DateFormatting.formatRelativeTime) ?? "None",
                description: detail.lastSuccessAt.map(DateFormatting.formatAbsoluteTime)
            )
            DashboardCard(
                label: "Last Failure",
                value: detail.lastFailureAt.map(DateFormatting.formatRelativeTime) ?? "None",
                description: detail.lastFailureAt.map(DateFormatting.formatAbsoluteTime)
            )
            DashboardCard(
                label: "Interventions",
                value: "\(detail.openInterventionCount)",
                description: detail.openInterventionCount == 0 ? "No open interventions" : "Needs operator attention",
                valueColor: detail.openInterventionCount == 0 ? .green : .orange
            )
            DashboardCard(
                label: "Approvals",
                value: "\(detail.pendingApprovalCount)",
                description: detail.pendingApprovalCount == 0 ? "No pending approvals" : "Waiting for approval",
                valueColor: detail.pendingApprovalCount == 0 ? .green : .orange
            )
        }
    }
}
