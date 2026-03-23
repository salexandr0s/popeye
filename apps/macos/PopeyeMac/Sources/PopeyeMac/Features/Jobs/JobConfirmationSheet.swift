import SwiftUI
import PopeyeAPI

struct JobConfirmationSheet: View {
    let action: JobInspectorView.Action
    let jobId: String
    @Binding var pendingAction: JobInspectorView.Action?
    let store: JobsStore

    var body: some View {
        switch action {
        case .pause:
            ConfirmationSheet(
                title: "Pause Job",
                message: "This job will stop processing until resumed.",
                confirmLabel: "Pause",
                textFieldValue: .constant(""),
                onConfirm: {
                    pendingAction = nil
                    Task { await store.pauseJob(id: jobId) }
                },
                onCancel: { pendingAction = nil }
            )
        case .resume:
            ConfirmationSheet(
                title: "Resume Job",
                message: "This job will resume processing from where it left off.",
                confirmLabel: "Resume",
                textFieldValue: .constant(""),
                onConfirm: {
                    pendingAction = nil
                    Task { await store.resumeJob(id: jobId) }
                },
                onCancel: { pendingAction = nil }
            )
        case .enqueue:
            ConfirmationSheet(
                title: "Re-enqueue Job",
                message: "This job will be placed back in the queue for processing.",
                confirmLabel: "Enqueue",
                textFieldValue: .constant(""),
                onConfirm: {
                    pendingAction = nil
                    Task { await store.enqueueJob(id: jobId) }
                },
                onCancel: { pendingAction = nil }
            )
        }
    }
}
