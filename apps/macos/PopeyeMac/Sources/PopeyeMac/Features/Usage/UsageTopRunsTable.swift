import SwiftUI
import PopeyeAPI

struct UsageTopRunsTable: View {
    let runs: [ReceiptRecordDTO]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Most Expensive Runs")
                .font(.headline)
                .foregroundStyle(.secondary)

            if runs.isEmpty {
                Text("No runs")
                    .foregroundStyle(.tertiary)
                    .font(.callout)
            } else {
                table
            }
        }
    }

    private var table: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Run")
                    .frame(width: 100, alignment: .leading)
                Text("Model")
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("Status")
                    .frame(width: 90, alignment: .leading)
                Text("Tokens")
                    .frame(width: 80, alignment: .trailing)
                Text("Cost")
                    .frame(width: 80, alignment: .trailing)
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .padding(.vertical, 8)
            .padding(.horizontal, 12)

            Divider()

            ForEach(Array(runs.enumerated()), id: \.element.id) { index, receipt in
                HStack {
                    Text(IdentifierFormatting.formatShortID(receipt.runId))
                        .font(.system(.caption, design: .monospaced))
                        .frame(width: 100, alignment: .leading)

                    Text(receipt.usage.model)
                        .font(.callout)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    StatusBadge(state: receipt.status)
                        .frame(width: 90, alignment: .leading)

                    Text(IdentifierFormatting.formatTokenCount(receipt.usage.tokensIn + receipt.usage.tokensOut))
                        .font(.callout.monospacedDigit())
                        .frame(width: 80, alignment: .trailing)

                    Text(CurrencyFormatting.formatCostUSD(receipt.usage.estimatedCostUsd))
                        .font(.callout.monospacedDigit())
                        .frame(width: 80, alignment: .trailing)
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 12)
                if index < runs.count - 1 {
                    Divider()
                }
            }
        }
        .background(.background)
        .clipShape(.rect(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(.separator, lineWidth: 0.5)
        }
    }
}
