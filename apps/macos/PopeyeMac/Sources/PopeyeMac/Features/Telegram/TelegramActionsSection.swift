import SwiftUI
import PopeyeAPI

struct TelegramActionsSection: View {
    let status: String
    let store: TelegramStore
    @Binding var pendingAction: TelegramDeliveryInspector.Action?

    var body: some View {
        if TelegramStore.canResolve(status: status) {
            HStack(spacing: 8) {
                Button("Confirm Sent", systemImage: "checkmark.circle") {
                    pendingAction = .confirmSent
                }
                .buttonStyle(.borderedProminent)
                .tint(.accentColor)

                Button("Resend", systemImage: "arrow.clockwise") {
                    pendingAction = .resend
                }
                .buttonStyle(.borderedProminent)
                .tint(.accentColor)

                Button("Abandon", systemImage: "xmark.circle") {
                    pendingAction = .abandon
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)

                if store.mutationState == .executing {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .disabled(store.mutationState == .executing)
        }
    }
}
