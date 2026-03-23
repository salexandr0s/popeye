import SwiftUI
import Charts
import PopeyeAPI

struct UsageStatusBreakdown: View {
    let statuses: [UsageStore.StatusBreakdown]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Runs by Outcome")
                .font(.headline)
                .foregroundStyle(.secondary)

            if statuses.isEmpty {
                Text("No data")
                    .foregroundStyle(.tertiary)
                    .font(.callout)
            } else {
                statusChart
                statusTable
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusChart: some View {
        Chart(statuses) { status in
            SectorMark(
                angle: .value("Count", status.count),
                innerRadius: .ratio(0.5),
                angularInset: 1.5
            )
            .foregroundStyle(by: .value("Status", status.status))
        }
        .chartForegroundStyleScale { (status: String) -> Color in
            switch status {
            case "succeeded": .green
            case "failed": .red
            case "cancelled": .secondary
            case "abandoned": .orange
            default: .blue
            }
        }
        .chartLegend(position: .bottom)
        .frame(height: 180)
        .padding(12)
        .background(.background)
        .clipShape(.rect(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(.separator, lineWidth: 0.5)
        }
    }

    private var statusTable: some View {
        VStack(spacing: 0) {
            ForEach(Array(statuses.enumerated()), id: \.element.id) { index, status in
                HStack {
                    StatusBadge(state: status.status)
                    Spacer()
                    Text("\(status.count)")
                        .font(.callout.monospacedDigit())
                    Text(CurrencyFormatting.formatCostUSD(status.cost))
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 80, alignment: .trailing)
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 12)
                if index < statuses.count - 1 {
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
