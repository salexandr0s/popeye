import SwiftUI
import PopeyeAPI

struct FinanceOverviewSection: View {
    let digest: FinanceDigestDTO?

    @ViewBuilder
    var body: some View {
        if let digest {
            LazyVGrid(columns: PopeyeUI.cardColumns(minimum: 160, maximum: 240), spacing: PopeyeUI.cardSpacing) {
                DashboardCard(
                    label: "Income",
                    value: digest.totalIncome.formatted(.currency(code: "USD")),
                    description: digest.period,
                    valueColor: .green
                )
                DashboardCard(
                    label: "Expenses",
                    value: digest.totalExpenses.formatted(.currency(code: "USD")),
                    description: digest.period,
                    valueColor: .red
                )
                DashboardCard(
                    label: "Anomalies",
                    value: "\(digest.anomalyFlags.count)",
                    description: digest.anomalyFlags.isEmpty ? "No anomaly flags" : "Review flagged transactions",
                    valueColor: digest.anomalyFlags.isEmpty ? .green : .orange
                )
            }
        }
    }
}
