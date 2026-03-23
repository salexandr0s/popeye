import SwiftUI
import PopeyeAPI

struct EstimatedCostCard: View {
    let usage: UsageSummaryDTO

    var body: some View {
        DashboardCard(
            label: "Estimated Cost",
            value: CurrencyFormatting.formatCostUSD(usage.estimatedCostUsd),
            description: "↓\(IdentifierFormatting.formatTokenCount(usage.tokensIn)) ↑\(IdentifierFormatting.formatTokenCount(usage.tokensOut)) tokens"
        )
    }
}
