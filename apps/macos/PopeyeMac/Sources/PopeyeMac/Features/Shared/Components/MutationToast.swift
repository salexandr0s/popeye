import SwiftUI

struct MutationToast: View {
    let message: String
    let isError: Bool
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: isError ? "xmark.circle.fill" : "checkmark.circle.fill")
                .foregroundStyle(isError ? .red : .green)
            Text(message)
                .font(.callout)
            Spacer()
            Button("Dismiss", systemImage: "xmark", action: onDismiss)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .labelStyle(.iconOnly)
                .accessibilityLabel("Dismiss notification")
        }
        .padding(12)
        .background(isError ? Color.red.opacity(0.1) : Color.green.opacity(0.1))
        .clipShape(.rect(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(isError ? .red.opacity(0.3) : .green.opacity(0.3), lineWidth: 0.5)
        )
        .task(id: message) {
            try? await Task.sleep(for: .seconds(4))
            onDismiss()
        }
    }
}
