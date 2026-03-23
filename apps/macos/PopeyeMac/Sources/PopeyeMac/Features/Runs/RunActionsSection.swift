import SwiftUI
import PopeyeAPI

struct RunActionsSection: View {
    let state: String
    let store: RunsStore
    @Binding var pendingAction: RunInspectorView.Action?

    var body: some View {
        let hasActions = RunsStore.canRetry(state: state) || RunsStore.canCancel(state: state)

        if hasActions {
            HStack(spacing: 8) {
                if RunsStore.canCancel(state: state) {
                    Button("Cancel Run", systemImage: "xmark.circle", role: .destructive) {
                        pendingAction = .cancel
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }
                if RunsStore.canRetry(state: state) {
                    Button("Retry Run", systemImage: "arrow.counterclockwise") {
                        pendingAction = .retry
                    }
                    .buttonStyle(.borderedProminent)
                }
                if store.mutationState == .executing {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .disabled(store.mutationState == .executing)
        }
    }
}
