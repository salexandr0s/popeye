import SwiftUI
import PopeyeAPI

struct RunInspectorView: View {
    let detail: RunDetailSnapshot
    let taskTitle: String
    let store: RunsStore

    @State private var pendingAction: Action?

    enum Action: Identifiable {
        case retry, cancel
        var id: String { String(describing: self) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                mutationToast
                RunActionsSection(state: detail.run.state, store: store, pendingAction: $pendingAction)
                headerSection
                if let error = detail.run.error {
                    errorSection(error)
                }
                if let envelope = detail.envelope {
                    ExecutionEnvelopeSection(envelope: envelope)
                }
                if let reply = detail.reply, let text = reply.reply, !text.isEmpty {
                    RunReplySection(reply: text)
                }
                if !detail.events.isEmpty {
                    RunEventsTimeline(events: detail.events)
                }
                if let receipt = detail.receipt {
                    receiptLink(receipt)
                }
            }
            .padding()
        }
        .sheet(item: $pendingAction) { action in
            RunConfirmationSheet(action: action, runId: detail.run.id, pendingAction: $pendingAction, store: store)
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

    // MARK: - Sections

    private var headerSection: some View {
        InspectorSection(title: "Run Details") {
            DetailRow(label: "State", value: detail.run.state)
            CopyableRow(label: "Run ID", value: detail.run.id)
            CopyableRow(label: "Job ID", value: detail.run.jobId)
            DetailRow(label: "Task", value: taskTitle)
            DetailRow(label: "Workspace", value: IdentifierFormatting.formatShortID(detail.run.workspaceId))
            DetailRow(label: "Profile", value: IdentifierFormatting.formatShortID(detail.run.profileId))
            if let sessionRef = detail.run.engineSessionRef {
                DetailRow(label: "Session Ref", value: IdentifierFormatting.formatShortID(sessionRef))
            }
            DetailRow(label: "Started", value: DateFormatting.formatAbsoluteTime(detail.run.startedAt))
            if let finished = detail.run.finishedAt {
                DetailRow(label: "Finished", value: DateFormatting.formatAbsoluteTime(finished))
                DetailRow(label: "Duration", value: durationString)
            }
        }
    }

    private func errorSection(_ error: String) -> some View {
        InspectorSection(title: "Error") {
            Text(error)
                .font(.callout)
                .foregroundStyle(.red)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func receiptLink(_ receipt: ReceiptRecordDTO) -> some View {
        InspectorSection(title: "Receipt") {
            DetailRow(label: "Receipt ID", value: IdentifierFormatting.formatShortID(receipt.id))
            DetailRow(label: "Status", value: receipt.status)
            DetailRow(label: "Cost", value: CurrencyFormatting.formatCostUSD(receipt.usage.estimatedCostUsd))
        }
    }

    private var durationString: String {
        guard let start = DateFormatting.parseISO8601(detail.run.startedAt),
              let endStr = detail.run.finishedAt,
              let end = DateFormatting.parseISO8601(endStr) else {
            return "--"
        }
        return DurationFormatting.formatDuration(end.timeIntervalSince(start))
    }
}
