import SwiftUI
import PopeyeAPI

struct ApprovalConfirmationSheet: View {
    let decision: ApprovalInspector.Decision
    let approvalId: String
    @Binding var pendingDecision: ApprovalInspector.Decision?
    @Binding var decisionReason: String
    let store: ApprovalsStore

    var body: some View {
        let isApproval = decision == .approved
        ConfirmationSheet(
            title: isApproval ? "Approve Request" : "Deny Request",
            message: isApproval
                ? "This will grant permission for the requested action."
                : "This will deny the requested action. The run may fail or require a different approach.",
            isDestructive: !isApproval,
            confirmLabel: isApproval ? "Approve" : "Deny",
            showsTextField: true,
            textFieldLabel: "Reason (optional)",
            textFieldValue: $decisionReason,
            onConfirm: {
                let reason = decisionReason.isEmpty ? nil : decisionReason
                pendingDecision = nil
                Task { await store.resolveApproval(id: approvalId, decision: decision.rawValue, reason: reason) }
                decisionReason = ""
            },
            onCancel: {
                pendingDecision = nil
                decisionReason = ""
            }
        )
    }
}
