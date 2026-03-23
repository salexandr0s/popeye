import SwiftUI
import Charts
import PopeyeAPI

struct UsageModelBreakdown: View {
    let models: [UsageStore.ModelUsage]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Cost by Model")
                .font(.headline)
                .foregroundStyle(.secondary)

            if models.isEmpty {
                Text("No model data")
                    .foregroundStyle(.tertiary)
                    .font(.callout)
            } else {
                modelChart
                modelTable
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var modelChart: some View {
        Chart(models) { model in
            SectorMark(
                angle: .value("Cost", model.cost),
                innerRadius: .ratio(0.5),
                angularInset: 1.5
            )
            .foregroundStyle(by: .value("Model", model.model))
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

    private var modelTable: some View {
        VStack(spacing: 0) {
            ForEach(Array(models.enumerated()), id: \.element.id) { index, model in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.model)
                            .font(.callout.weight(.medium))
                        Text(model.provider)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(CurrencyFormatting.formatCostUSD(model.cost))
                            .font(.callout.monospacedDigit())
                        Text("\(model.runs) runs")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 12)
                if index < models.count - 1 {
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
