import SwiftUI

struct DashboardCard: View {
    let label: String
    let value: String
    var description: String?
    var valueColor: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .fontWeight(.medium)
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(.secondary)

            Text(value)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(valueColor)

            if let description {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.background)
        .clipShape(.rect(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(.separator, lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.04), radius: 2, y: 1)
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
