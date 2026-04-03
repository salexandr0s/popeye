import SwiftUI
import PopeyeAPI

struct MemoryInspectorView: View {
    let memory: MemoryRecordDTO
    @Bindable var store: MemoryStore

    @State private var showContent = false
    @State private var showHistory = false
    @State private var pendingAction: MemoryAction?
    @State private var confirmationNote = ""

    enum MemoryAction: Identifiable {
        case pin
        case forget

        var id: String {
            switch self {
            case .pin: "pin"
            case .forget: "forget"
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                if store.detailPhase != .idle {
                    OperationStatusView(
                        phase: store.detailPhase,
                        loadingTitle: "Refreshing memory details…",
                        failureTitle: "Memory details unavailable",
                        retryAction: { Task { await store.loadDetail(id: memory.id) } }
                    )
                }

                if store.promotionProposalPhase != .idle {
                    OperationStatusView(
                        phase: store.promotionProposalPhase,
                        loadingTitle: "Preparing promotion proposal…",
                        failureTitle: "Promotion proposal failed",
                        retryAction: { Task { await store.proposePromotion(id: memory.id, targetPath: "MEMORY.md") } }
                    )
                }

                MemoryInspectorSummarySection(memory: memory)
                MemoryInspectorProvenanceSection(memory: memory)
                MemoryInspectorContentSection(memory: memory, showContent: $showContent)
                MemoryInspectorHistorySection(
                    history: store.selectedHistory,
                    phase: store.historyPhase,
                    showHistory: $showHistory,
                    loadHistory: loadHistory
                )
                MemoryInspectorActionsSection(
                    isMutating: store.isMutating,
                    onPin: { pendingAction = .pin },
                    onForget: { pendingAction = .forget }
                )
            }
            .padding(PopeyeUI.contentPadding)
        }
        .overlay(alignment: .bottomTrailing) {
            MutationStateOverlay(state: store.mutationState, dismiss: store.dismissMutation)
                .padding(PopeyeUI.contentPadding)
        }
        .sheet(item: $pendingAction) { action in
            confirmationSheet(for: action)
        }
    }

    @ViewBuilder
    private func confirmationSheet(for action: MemoryAction) -> some View {
        switch action {
        case .pin:
            ConfirmationSheet(
                title: "Pin Memory",
                message: "Pin this memory to protect it from consolidation and confidence decay.",
                confirmLabel: "Pin",
                showsTextField: true,
                textFieldLabel: "Reason (optional)",
                textFieldValue: $confirmationNote,
                onConfirm: confirmPin,
                onCancel: dismissConfirmation
            )
        case .forget:
            ConfirmationSheet(
                title: "Forget Memory",
                message: "Mark this memory as forgotten. It will be excluded from retrieval.",
                isDestructive: true,
                confirmLabel: "Forget",
                showsTextField: true,
                textFieldLabel: "Reason (optional)",
                textFieldValue: $confirmationNote,
                onConfirm: confirmForget,
                onCancel: dismissConfirmation
            )
        }
    }

    private func loadHistory() {
        Task {
            await store.loadHistory(id: memory.id)
        }
    }

    private func confirmPin() {
        let reason = confirmationNote.isEmpty ? nil : confirmationNote
        Task {
            await store.pinMemory(id: memory.id, targetKind: "fact", reason: reason)
        }
        confirmationNote = ""
        pendingAction = nil
    }

    private func confirmForget() {
        let reason = confirmationNote.isEmpty ? nil : confirmationNote
        Task {
            await store.forgetMemory(id: memory.id, reason: reason)
        }
        confirmationNote = ""
        pendingAction = nil
    }

    private func dismissConfirmation() {
        confirmationNote = ""
        pendingAction = nil
    }
}
