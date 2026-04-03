import SwiftUI
import PopeyeAPI

/// A row that displays a short-formatted identifier as a tappable link
/// with a copy button. Used for cross-navigation between inspector views.
struct NavigableIDRow: View {
    let label: String
    let id: String
    let action: () -> Void

    var body: some View {
        HStack(alignment: .top) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(minWidth: 80, idealWidth: 120, alignment: .trailing)
                .layoutPriority(-1)
                .accessibilityHidden(true)
            Button(action: action) {
                Text(IdentifierFormatting.formatShortID(id))
                    .underline()
            }
            .buttonStyle(.plain)
            .foregroundStyle(.link)
            .accessibilityLabel("Open \(label)")
            .accessibilityValue(IdentifierFormatting.formatShortID(id))
            .accessibilityHint("Opens the related details")
            Spacer()
            Button("Copy \(label)", systemImage: "doc.on.doc") {
                Clipboard.copy(id)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .labelStyle(.iconOnly)
            .controlSize(.small)
            .help("Copy \(label)")
            .accessibilityLabel("Copy \(label)")
            .accessibilityHint("Copies this identifier to the clipboard")
        }
        .font(.callout)
        .accessibilityElement(children: .contain)
    }
}
