import SwiftUI
import PopeyeAPI

struct CCConfirmationSheet: View {
    let mutation: CommandCenterInspector.PendingMutation
    @Binding var pendingMutation: CommandCenterInspector.PendingMutation?
    @Binding var textFieldValue: String
    let store: CommandCenterStore

    var body: some View {
        switch mutation {
        case .retryRun(let id):
            ConfirmationSheet(
                title: "Retry Run", message: "Create a new execution attempt.",
                confirmLabel: "Retry", textFieldValue: .constant(""),
                onConfirm: { pendingMutation = nil; Task { await store.retryRun(id: id) } },
                onCancel: { pendingMutation = nil }
            )
        case .cancelRun(let id):
            ConfirmationSheet(
                title: "Cancel Run", message: "Cancel the currently running execution.",
                isDestructive: true, confirmLabel: "Cancel Run", textFieldValue: .constant(""),
                onConfirm: { pendingMutation = nil; Task { await store.cancelRun(id: id) } },
                onCancel: { pendingMutation = nil }
            )
        case .pauseJob(let id):
            ConfirmationSheet(
                title: "Pause Job", message: "Stop processing until resumed.",
                confirmLabel: "Pause", textFieldValue: .constant(""),
                onConfirm: { pendingMutation = nil; Task { await store.pauseJob(id: id) } },
                onCancel: { pendingMutation = nil }
            )
        case .resumeJob(let id):
            ConfirmationSheet(
                title: "Resume Job", message: "Resume processing from where it left off.",
                confirmLabel: "Resume", textFieldValue: .constant(""),
                onConfirm: { pendingMutation = nil; Task { await store.resumeJob(id: id) } },
                onCancel: { pendingMutation = nil }
            )
        case .enqueueJob(let id):
            ConfirmationSheet(
                title: "Re-enqueue Job", message: "Place the job back in the queue for processing.",
                confirmLabel: "Enqueue", textFieldValue: .constant(""),
                onConfirm: { pendingMutation = nil; Task { await store.enqueueJob(id: id) } },
                onCancel: { pendingMutation = nil }
            )
        case .resolveIntervention(let id):
            ConfirmationSheet(
                title: "Resolve Intervention", message: "Mark this intervention as resolved.",
                confirmLabel: "Resolve", showsTextField: true, textFieldLabel: "Resolution note (optional)",
                textFieldValue: $textFieldValue,
                onConfirm: {
                    let note = textFieldValue.isEmpty ? nil : textFieldValue
                    pendingMutation = nil
                    Task { await store.resolveIntervention(id: id, note: note) }
                    textFieldValue = ""
                },
                onCancel: { pendingMutation = nil; textFieldValue = "" }
            )
        }
    }
}
