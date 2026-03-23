import SwiftUI
import PopeyeAPI

struct InterventionConfirmationSheet: View {
    let interventionId: String
    @Binding var pendingAction: InterventionInspector.Action?
    @Binding var resolutionNote: String
    let store: InterventionsStore

    var body: some View {
        ConfirmationSheet(
            title: "Resolve Intervention",
            message: "Mark this intervention as resolved. You can optionally add a resolution note.",
            confirmLabel: "Resolve",
            showsTextField: true,
            textFieldLabel: "Resolution note (optional)",
            textFieldValue: $resolutionNote,
            onConfirm: {
                let note = resolutionNote.isEmpty ? nil : resolutionNote
                pendingAction = nil
                Task { await store.resolveIntervention(id: interventionId, note: note) }
                resolutionNote = ""
            },
            onCancel: {
                pendingAction = nil
                resolutionNote = ""
            }
        )
    }
}
