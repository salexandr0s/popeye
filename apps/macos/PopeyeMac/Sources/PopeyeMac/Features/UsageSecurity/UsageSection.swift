import SwiftUI
import PopeyeAPI

struct UsageSection: View {
    let usage: UsageSummaryDTO?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Usage Summary")
                .font(.headline)
                .foregroundStyle(.secondary)
            if let usage {
                LazyVGrid(columns: columns, spacing: 12) {
                    DashboardCard(
                        label: "Total Runs",
                        value: "\(usage.runs)"
                    )
                    DashboardCard(
                        label: "Tokens In",
                        value: IdentifierFormatting.formatTokenCount(usage.tokensIn)
                    )
                    DashboardCard(
                        label: "Tokens Out",
                        value: IdentifierFormatting.formatTokenCount(usage.tokensOut)
                    )
                    DashboardCard(
                        label: "Estimated Cost",
                        value: CurrencyFormatting.formatCostUSD(usage.estimatedCostUsd)
                    )
                }
            } else {
                Text("No usage data available")
                    .foregroundStyle(.tertiary)
                    .font(.callout)
            }
        }
    }
}
