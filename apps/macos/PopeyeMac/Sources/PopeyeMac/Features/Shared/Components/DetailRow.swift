import SwiftUI

struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(minWidth: 80, idealWidth: 120, alignment: .trailing)
                .layoutPriority(-1)
            Text(value)
                .textSelection(.enabled)
        }
        .font(.callout)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(value.isEmpty ? "None" : value)
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 4) {
        DetailRow(label: "State", value: "Running")
        DetailRow(label: "Run ID", value: "abc123def456")
        DetailRow(label: "Started", value: "2 minutes ago")
    }
    .padding()
}
