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
                MemoryInspectorSummarySection(memory: memory)
                MemoryInspectorProvenanceSection(memory: memory)
                MemoryInspectorContentSection(memory: memory, showContent: $showContent)
                MemoryInspectorHistorySection(
                    history: store.selectedHistory,
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
        .overlay(alignment: .top) {
            mutationToast
                .padding(.top, 12)
                .padding(.horizontal, PopeyeUI.contentPadding)
        }
        .sheet(item: $pendingAction) { action in
            confirmationSheet(for: action)
        }
    }

    @ViewBuilder
    private var mutationToast: some View {
        switch store.mutationState {
        case .succeeded(let msg):
            MutationToast(message: msg, isError: false, onDismiss: { store.dismissMutation() })
        case .failed(let msg):
            MutationToast(message: msg, isError: true, onDismiss: { store.dismissMutation() })
        default:
            EmptyView()
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
