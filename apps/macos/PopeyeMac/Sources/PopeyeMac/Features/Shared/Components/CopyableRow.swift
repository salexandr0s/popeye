import SwiftUI

struct CopyableRow: View {
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
            Spacer()
            Button("Copy", systemImage: "doc.on.doc") {
                Clipboard.copy(value)
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
