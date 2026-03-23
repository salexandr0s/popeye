import SwiftUI
import PopeyeAPI

struct UsageSummaryCards: View {
    let store: UsageStore
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 16), count: 5)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Overview")
                .font(.headline)
                .foregroundStyle(.secondary)
            LazyVGrid(columns: columns, spacing: 16) {
                DashboardCard(
                    label: "Total Cost",
                    value: CurrencyFormatting.formatCostUSD(store.totalCost),
                    description: "\(store.totalRuns) runs"
                )
                DashboardCard(
                    label: "Avg Cost/Run",
                    value: CurrencyFormatting.formatCostUSD(store.averageCostPerRun)
                )
                DashboardCard(
                    label: "Tokens In",
                    value: IdentifierFormatting.formatTokenCount(store.totalTokensIn)
                )
                DashboardCard(
                    label: "Tokens Out",
                    value: IdentifierFormatting.formatTokenCount(store.totalTokensOut)
                )
                DashboardCard(
                    label: "Success Rate",
                    value: store.successRate.formatted(.percent.precision(.fractionLength(0))),
                    valueColor: store.successRate >= 0.9 ? .green : store.successRate >= 0.7 ? .orange : .red
                )
            }
        }
    }
}
