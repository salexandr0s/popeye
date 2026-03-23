import SwiftUI
import PopeyeAPI

struct ApprovalActionsSection: View {
    let status: String
    let store: ApprovalsStore
    @Binding var pendingDecision: ApprovalInspector.Decision?

    var body: some View {
        if ApprovalsStore.canResolve(status: status) {
            HStack(spacing: 8) {
                Button("Approve", systemImage: "checkmark.circle") {
                    pendingDecision = .approved
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)

                Button("Deny", systemImage: "xmark.circle", role: .destructive) {
                    pendingDecision = .denied
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
