import SwiftUI
import PopeyeAPI

struct TelegramConfirmationSheet: View {
    let deliveryId: String
    let action: TelegramDeliveryInspector.Action
    @Binding var pendingAction: TelegramDeliveryInspector.Action?
    @Binding var operatorNote: String
    @Binding var sentMessageId: String
    let store: TelegramStore

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: action.isDestructive ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.system(size: 36))
                .foregroundStyle(action.isDestructive ? .red : .blue)
                .accessibilityLabel(action.isDestructive ? "Warning" : "Confirmation")

            Text("Resolve Delivery")
                .font(.headline)

            Text(action.confirmationMessage)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if action == .confirmSent {
                TextField("Sent Telegram message ID (optional)", text: $sentMessageId)
                    .textFieldStyle(.roundedBorder)
            }

            TextField("Operator note (optional)", text: $operatorNote, axis: .vertical)
                .lineLimit(3...6)
                .textFieldStyle(.roundedBorder)

            HStack(spacing: 12) {
                Button("Cancel", role: .cancel) {
                    pendingAction = nil
                    operatorNote = ""
                    sentMessageId = ""
                }
                .keyboardShortcut(.escape)

                Button(action.confirmLabel, role: action.isDestructive ? .destructive : nil) {
                    let note = operatorNote.isEmpty ? nil : operatorNote
                    let msgId = sentMessageId.isEmpty ? nil : Int(sentMessageId)
                    pendingAction = nil
                    Task {
                        await store.resolveDelivery(
                            id: deliveryId,
                            action: action.apiAction,
                            note: note,
                            sentMessageId: msgId
                        )
                    }
                    operatorNote = ""
                    sentMessageId = ""
                }
                .keyboardShortcut(.return)
                .buttonStyle(.borderedProminent)
                .tint(action.isDestructive ? .red : .blue)
            }
        }
        .padding(24)
        .frame(width: 360)
    }
}
