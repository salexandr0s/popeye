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
                .accessibilityHidden(true)
            Text(value)
                .textSelection(.enabled)
                .accessibilityLabel(label)
                .accessibilityValue(value.isEmpty ? "None" : value)
            Spacer()
            Button("Copy \(label)", systemImage: "doc.on.doc") {
                Clipboard.copy(value)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .labelStyle(.iconOnly)
            .controlSize(.small)
            .help("Copy \(label)")
            .accessibilityLabel("Copy \(label)")
            .accessibilityHint("Copies this value to the clipboard")
        }
        .font(.callout)
        .accessibilityElement(children: .contain)
    }
}
