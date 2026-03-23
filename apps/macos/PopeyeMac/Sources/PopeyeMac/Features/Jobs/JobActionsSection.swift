import SwiftUI
import PopeyeAPI

struct JobActionsSection: View {
    let status: String
    let store: JobsStore
    @Binding var pendingAction: JobInspectorView.Action?

    var body: some View {
        let hasActions = JobsStore.canPause(status: status)
            || JobsStore.canResume(status: status)
            || JobsStore.canEnqueue(status: status)

        if hasActions {
            HStack(spacing: 8) {
                if JobsStore.canPause(status: status) {
                    Button("Pause", systemImage: "pause.circle") {
                        pendingAction = .pause
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
                }
                if JobsStore.canResume(status: status) {
                    Button("Resume", systemImage: "play.circle") {
                        pendingAction = .resume
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }
                if JobsStore.canEnqueue(status: status) {
                    Button("Enqueue", systemImage: "arrow.uturn.backward.circle") {
                        pendingAction = .enqueue
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
