import SwiftUI
import PopeyeAPI

struct AutomationScheduleSection: View {
    let detail: AutomationDetailDTO

    var body: some View {
        InspectorSection(title: "Schedule") {
            DetailRow(label: "Cadence", value: detail.scheduleSummary)
            DetailRow(label: "Next expected", value: detail.nextExpectedAt.map(DateFormatting.formatAbsoluteTime) ?? "Not scheduled")
            DetailRow(label: "Workspace", value: detail.workspaceId)
            DetailRow(label: "Source", value: detail.source.replacingOccurrences(of: "_", with: " ").capitalized)
        }
    }
}
