import SwiftUI

struct DashboardCard: View {
    let label: String
    let value: String
    var description: String?
    var valueColor: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text(value)
                .font(.title3.bold())
                .foregroundStyle(valueColor)

            if let description {
                Text(description)
                    .font(.callout)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.background)
        .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
        .overlay {
            RoundedRectangle(cornerRadius: PopeyeUI.cardCornerRadius)
                .strokeBorder(.separator, lineWidth: 0.5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: String {
        if let description, description.isEmpty == false {
            return "\(value). \(description)"
        }

        return value
    }
}

#Preview {
    HStack {
        DashboardCard(label: "Status", value: "Healthy", description: "Engine: pi", valueColor: .green)
        DashboardCard(label: "Running Jobs", value: "3", description: "+2 queued")
        DashboardCard(label: "Cost", value: "$3.4500", description: "↓150k ↑80k tokens")
    }
    .padding()
}
