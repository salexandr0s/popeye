import SwiftUI
import PopeyeAPI

struct JobInspectorView: View {
    let detail: JobDetailSnapshot
    let taskTitle: String
    let store: JobsStore

    @State private var pendingAction: Action?

    enum Action: Identifiable {
        case pause, resume, enqueue
        var id: String { String(describing: self) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                mutationToast
                JobActionsSection(status: detail.job.status, store: store, pendingAction: $pendingAction)
                headerSection
                timestampsSection
                if let lease = detail.lease {
                    JobLeaseSection(lease: lease)
                }
                relatedSection
            }
            .padding()
        }
        .sheet(item: $pendingAction) { action in
            JobConfirmationSheet(action: action, jobId: detail.job.id, pendingAction: $pendingAction, store: store)
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
        InspectorSection(title: "Job Details") {
            DetailRow(label: "Status", value: detail.job.status)
            CopyableRow(label: "Job ID", value: detail.job.id)
            DetailRow(label: "Task", value: taskTitle)
            DetailRow(label: "Workspace", value: IdentifierFormatting.formatShortID(detail.job.workspaceId))
            DetailRow(label: "Retry Count", value: "\(detail.job.retryCount)")
        }
    }

    private var timestampsSection: some View {
        InspectorSection(title: "Timestamps") {
            DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(detail.job.createdAt))
            DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(detail.job.updatedAt))
            DetailRow(label: "Available At", value: DateFormatting.formatAbsoluteTime(detail.job.availableAt))
        }
    }

    private var relatedSection: some View {
        InspectorSection(title: "Related") {
            if let lastRunId = detail.job.lastRunId {
                DetailRow(label: "Last Run", value: IdentifierFormatting.formatShortID(lastRunId))
            } else {
                DetailRow(label: "Last Run", value: "None")
            }
            DetailRow(label: "Task ID", value: IdentifierFormatting.formatShortID(detail.job.taskId))
        }
    }
}
