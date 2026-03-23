import SwiftUI

struct ConfirmationSheet: View {
    let title: String
    let message: String
    var isDestructive: Bool = false
    var confirmLabel: String = "Confirm"
    var showsTextField: Bool = false
    var textFieldLabel: String = "Note"
    @Binding var textFieldValue: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: isDestructive ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.system(size: 36))
                .foregroundStyle(isDestructive ? .red : .blue)
                .accessibilityLabel(isDestructive ? "Warning" : "Confirmation")

            Text(title)
                .font(.headline)

            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if showsTextField {
                TextField(textFieldLabel, text: $textFieldValue, axis: .vertical)
                    .lineLimit(3...6)
                    .textFieldStyle(.roundedBorder)
            }

            HStack(spacing: 12) {
                Button("Cancel", role: .cancel, action: onCancel)
                    .keyboardShortcut(.escape)
                Button(confirmLabel, role: isDestructive ? .destructive : nil, action: onConfirm)
                    .keyboardShortcut(.return)
                    .buttonStyle(.borderedProminent)
                    .tint(isDestructive ? .red : .blue)
            }
        }
        .padding(24)
        .frame(width: 360)
    }
}
