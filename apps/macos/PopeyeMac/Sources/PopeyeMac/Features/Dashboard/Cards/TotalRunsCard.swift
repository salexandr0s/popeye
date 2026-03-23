import SwiftUI
import PopeyeAPI

struct TotalRunsCard: View {
    let usage: UsageSummaryDTO

    var body: some View {
        DashboardCard(
            label: "Total Runs",
            value: "\(usage.runs)"
        )
    }
}
