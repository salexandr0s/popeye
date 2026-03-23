import SwiftUI
import PopeyeAPI

struct RunConfirmationSheet: View {
    let action: RunInspectorView.Action
    let runId: String
    @Binding var pendingAction: RunInspectorView.Action?
    let store: RunsStore

    var body: some View {
        switch action {
        case .cancel:
            ConfirmationSheet(
                title: "Cancel Run",
                message: "This will cancel the currently running execution. The run can be retried later.",
                isDestructive: true,
                confirmLabel: "Cancel Run",
                textFieldValue: .constant(""),
                onConfirm: {
                    pendingAction = nil
                    Task { await store.cancelRun(id: runId) }
                },
                onCancel: { pendingAction = nil }
            )
        case .retry:
            ConfirmationSheet(
                title: "Retry Run",
                message: "This will create a new execution attempt for this run.",
                confirmLabel: "Retry",
                textFieldValue: .constant(""),
                onConfirm: {
                    pendingAction = nil
                    Task { await store.retryRun(id: runId) }
                },
                onCancel: { pendingAction = nil }
            )
        }
    }
}
