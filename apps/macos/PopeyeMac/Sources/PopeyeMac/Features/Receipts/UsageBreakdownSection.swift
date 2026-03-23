import SwiftUI
import PopeyeAPI

struct UsageBreakdownSection: View {
    let usage: ReceiptUsageDTO

    var body: some View {
        InspectorSection(title: "Usage") {
            DetailRow(label: "Provider", value: usage.provider)
            DetailRow(label: "Model", value: usage.model)
            DetailRow(label: "Tokens In", value: IdentifierFormatting.formatTokenCount(usage.tokensIn))
            DetailRow(label: "Tokens Out", value: IdentifierFormatting.formatTokenCount(usage.tokensOut))
            DetailRow(label: "Est. Cost", value: CurrencyFormatting.formatCostUSD(usage.estimatedCostUsd))
        }
    }
}
