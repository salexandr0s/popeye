import SwiftUI
import PopeyeAPI

struct CCJobInspectorSection: View {
    let job: JobRecordDTO
    let taskTitle: String
    let store: CommandCenterStore
    @Binding var pendingMutation: CommandCenterInspector.PendingMutation?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                mutationToast
                jobActions
                InspectorSection(title: "Job") {
                    DetailRow(label: "Status", value: job.status)
                    DetailRow(label: "Job ID", value: job.id)
                    DetailRow(label: "Task", value: taskTitle)
                    DetailRow(label: "Retry Count", value: "\(job.retryCount)")
                    DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(job.createdAt))
                    DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(job.updatedAt))
                }
                if let lastRunId = job.lastRunId {
                    InspectorSection(title: "Related") {
                        DetailRow(label: "Last Run", value: IdentifierFormatting.formatShortID(lastRunId))
                    }
                }
            }
            .padding()
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
    private var jobActions: some View {
        let hasActions = MutationEligibility.canPauseJob(status: job.status)
            || MutationEligibility.canResumeJob(status: job.status)
            || MutationEligibility.canEnqueueJob(status: job.status)

        if hasActions {
            HStack(spacing: 8) {
                if MutationEligibility.canPauseJob(status: job.status) {
                    Button("Pause", systemImage: "pause.circle") {
                        pendingMutation = .pauseJob(job.id)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
                    .controlSize(.small)
                }
                if MutationEligibility.canResumeJob(status: job.status) {
                    Button("Resume", systemImage: "play.circle") {
                        pendingMutation = .resumeJob(job.id)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .controlSize(.small)
                }
                if MutationEligibility.canEnqueueJob(status: job.status) {
                    Button("Enqueue", systemImage: "arrow.uturn.backward.circle") {
                        pendingMutation = .enqueueJob(job.id)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                }
                if store.mutationState == .executing {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .disabled(store.mutationState == .executing)
        }
    }
}
