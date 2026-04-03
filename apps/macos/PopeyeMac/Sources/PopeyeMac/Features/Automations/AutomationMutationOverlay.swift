import SwiftUI
import PopeyeAPI

struct AutomationMutationOverlay: View {
    let state: MutationState
    let dismiss: () -> Void

    var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .executing:
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Applying change…")
                    .font(.callout)
            }
            .padding(12)
            .background(.regularMaterial)
            .clipShape(Capsule())
        case .succeeded(let message):
            MutationToast(message: message, isError: false, onDismiss: dismiss)
                .frame(width: 320)
        case .failed(let message):
            MutationToast(message: message, isError: true, onDismiss: dismiss)
                .frame(width: 320)
        }
    }
}
