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
            Button(action: action) {
                Text(IdentifierFormatting.formatShortID(id))
                    .underline()
            }
            .buttonStyle(.plain)
            .foregroundStyle(.link)
            .accessibilityLabel("Navigate to \(label)")
            Spacer()
            Button("Copy", systemImage: "doc.on.doc") {
                Clipboard.copy(id)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .labelStyle(.iconOnly)
            .controlSize(.small)
            .accessibilityLabel("Copy \(label)")
        }
        .font(.callout)
    }
}
