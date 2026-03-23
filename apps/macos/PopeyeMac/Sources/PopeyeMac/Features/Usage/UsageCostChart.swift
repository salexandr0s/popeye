import SwiftUI
import Charts
import PopeyeAPI

struct UsageCostChart: View {
    let dailyCosts: [UsageStore.DailyCost]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Cost Over Time")
                .font(.headline)
                .foregroundStyle(.secondary)

            if dailyCosts.isEmpty {
                noDataView
            } else {
                chartView
            }
        }
    }

    private var noDataView: some View {
        HStack(spacing: 8) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .foregroundStyle(.secondary)
            Text("No cost data to chart yet")
                .foregroundStyle(.tertiary)
        }
        .font(.callout)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
    }

    private var chartView: some View {
        Chart(dailyCosts) { day in
            BarMark(
                x: .value("Date", day.date, unit: .day),
                y: .value("Cost", day.cost)
            )
            .foregroundStyle(Color.accentColor.gradient)
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let cost = value.as(Double.self) {
                        Text(shortCurrency(cost))
                            .font(.caption)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic) { value in
                AxisGridLine()
                AxisValueLabel(format: .dateTime.month(.abbreviated).day(), centered: true)
            }
        }
        .frame(minHeight: 200, maxHeight: 300)
        .padding(12)
        .background(.background)
        .clipShape(.rect(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(.separator, lineWidth: 0.5)
        }
    }

    private func shortCurrency(_ value: Double) -> String {
        let precision = value < 0.01 ? 4 : 2
        return value.formatted(.currency(code: "USD").precision(.fractionLength(precision)))
    }
}
