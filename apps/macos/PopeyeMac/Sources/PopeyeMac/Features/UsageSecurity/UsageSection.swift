import SwiftUI
import PopeyeAPI

struct UsageSection: View {
    let usage: UsageSummaryDTO?

    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 180, maximum: 260)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Usage Summary")
                .font(.headline)
                .foregroundStyle(.secondary)
            if let usage {
                LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
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
