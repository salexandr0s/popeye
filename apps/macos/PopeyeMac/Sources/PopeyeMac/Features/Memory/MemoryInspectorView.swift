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
            VStack(alignment: .leading, spacing: 16) {
                headerSection
                provenanceSection
                contentSection
                historySection
                actionsSection
            }
            .padding(16)
        }
        .overlay(alignment: .top) {
            switch store.mutationState {
            case .succeeded(let msg):
                MutationToast(message: msg, isError: false, onDismiss: { store.dismissMutation() })
            case .failed(let msg):
                MutationToast(message: msg, isError: true, onDismiss: { store.dismissMutation() })
            default:
                EmptyView()
            }
        }
        .sheet(item: $pendingAction) { action in
            confirmationSheet(for: action)
        }
    }

    // MARK: - Sections

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            CopyableRow(label: "ID", value: memory.id)
            DetailRow(label: "Description", value: memory.description)

            HStack(spacing: 8) {
                StatusBadge(state: memory.memoryType)
                StatusBadge(state: memory.scope)
                StatusBadge(state: memory.classification)
                if memory.durable {
                    StatusBadge(state: "active")
                }
            }
        }
    }

    private var provenanceSection: some View {
        InspectorSection(title: "Provenance") {
            DetailRow(label: "Source Type", value: memory.sourceType)
            DetailRow(label: "Domain", value: memory.domain)
            DetailRow(label: "Confidence", value: memory.confidence.formatted(.percent.precision(.fractionLength(1))))
            if let runId = memory.sourceRunId {
                CopyableRow(label: "Source Run", value: runId)
            }
            if let ts = memory.sourceTimestamp {
                DetailRow(label: "Source Time", value: DateFormatting.formatAbsoluteTime(ts))
            }
            DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(memory.createdAt))
            if let reinforced = memory.lastReinforcedAt {
                DetailRow(label: "Last Reinforced", value: DateFormatting.formatRelativeTime(reinforced))
            }
            if memory.archivedAt != nil {
                StatusBadge(state: "expired")
            }
        }
    }

    private var contentSection: some View {
        InspectorSection(title: "Content") {
            DisclosureGroup("Show full content", isExpanded: $showContent) {
                Text(memory.content)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(.background.secondary)
                    .clipShape(.rect(cornerRadius: 6))
            }
        }
    }

    @ViewBuilder
    private var historySection: some View {
        InspectorSection(title: "History") {
            DisclosureGroup("Show history", isExpanded: $showHistory) {
                if let history = store.memoryHistory, history.memoryId == memory.id {
                    historyContent(history)
                } else {
                    Button("Load History") {
                        Task { await store.loadHistory(id: memory.id) }
                    }
                    .buttonStyle(.link)
                }
            }
        }
    }

    private func historyContent(_ history: MemoryHistoryDTO) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !history.versionChain.isEmpty {
                Text("Versions (\(history.versionChain.count))")
                    .font(.caption.bold())
                ForEach(history.versionChain) { version in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(version.isLatest ? "Current" : "Superseded")
                                .font(.caption)
                                .foregroundStyle(version.isLatest ? .primary : .secondary)
                            Spacer()
                            Text(DateFormatting.formatRelativeTime(version.createdAt))
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                        Text(version.text)
                            .font(.caption)
                            .lineLimit(3)
                            .foregroundStyle(.secondary)
                    }
                    .padding(6)
                    .background(.background.secondary)
                    .clipShape(.rect(cornerRadius: 4))
                }
            }

            if !history.operatorActions.isEmpty {
                Text("Operator Actions (\(history.operatorActions.count))")
                    .font(.caption.bold())
                ForEach(history.operatorActions) { action in
                    HStack {
                        Text(action.actionKind)
                            .font(.caption)
                        if !action.reason.isEmpty {
                            Text("— \(action.reason)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(DateFormatting.formatRelativeTime(action.createdAt))
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }

    private var actionsSection: some View {
        InspectorSection(title: "Actions") {
            HStack(spacing: 12) {
                Button("Pin") { pendingAction = .pin }
                Button("Forget", role: .destructive) { pendingAction = .forget }
            }
        }
    }

    // MARK: - Confirmation

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

    // MARK: - Actions

    private func confirmPin() {
        let reason = confirmationNote.isEmpty ? nil : confirmationNote
        Task { await store.pinMemory(id: memory.id, targetKind: "fact", reason: reason) }
        confirmationNote = ""
        pendingAction = nil
    }

    private func confirmForget() {
        let reason = confirmationNote.isEmpty ? nil : confirmationNote
        Task { await store.forgetMemory(id: memory.id, reason: reason) }
        confirmationNote = ""
        pendingAction = nil
    }

    private func dismissConfirmation() {
        confirmationNote = ""
        pendingAction = nil
    }
}
