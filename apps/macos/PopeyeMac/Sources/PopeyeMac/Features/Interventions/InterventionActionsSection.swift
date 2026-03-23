import SwiftUI
import PopeyeAPI

struct InterventionActionsSection: View {
    let status: String
    let store: InterventionsStore
    @Binding var pendingAction: InterventionInspector.Action?

    var body: some View {
        if InterventionsStore.canResolve(status: status) {
            HStack(spacing: 8) {
                Button("Resolve", systemImage: "checkmark.circle") {
                    pendingAction = .resolve
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)

                if store.mutationState == .executing {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .disabled(store.mutationState == .executing)
        }
    }
}
