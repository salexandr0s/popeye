import SwiftUI
import PopeyeAPI

struct ControlChangeReceiptCard: View {
    let receipt: MutationReceiptDTO
    let openDetails: () -> Void

    var body: some View {
        Button(action: openDetails) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(receipt.summary)
                            .font(.headline)
                            .multilineTextAlignment(.leading)

                        Text(receipt.component.capitalized)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()
                    StatusBadge(state: receipt.status)
                }

                Text(receipt.details)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)

                HStack(spacing: 12) {
                    Text(DateFormatting.formatRelativeTime(receipt.createdAt))
                    Text(formattedValue(receipt.kind))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(receipt.summary)
        .accessibilityValue(receiptAccessibilityValue)
        .accessibilityHint("Opens control change details")
    }

    private var receiptAccessibilityValue: String {
        [
            receipt.component.capitalized,
            formattedValue(receipt.status),
            formattedValue(receipt.kind),
            DateFormatting.formatRelativeTime(receipt.createdAt),
        ].joined(separator: ", ")
    }

    private func formattedValue(_ value: String) -> String {
        value.replacingOccurrences(of: "_", with: " ").capitalized
    }
}
