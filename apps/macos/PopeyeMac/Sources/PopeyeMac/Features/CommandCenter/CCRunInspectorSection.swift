import SwiftUI
import PopeyeAPI

struct CCRunInspectorSection: View {
    let run: RunRecordDTO
    let taskTitle: String
    let store: CommandCenterStore
    @Binding var pendingMutation: CommandCenterInspector.PendingMutation?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                runActions
                InspectorSection(title: "Run") {
                    DetailRow(label: "State", value: run.state)
                    DetailRow(label: "Run ID", value: run.id)
                    DetailRow(label: "Job ID", value: IdentifierFormatting.formatShortID(run.jobId))
                    DetailRow(label: "Task", value: taskTitle)
                    DetailRow(label: "Workspace", value: IdentifierFormatting.formatShortID(run.workspaceId))
                    DetailRow(label: "Started", value: DateFormatting.formatAbsoluteTime(run.startedAt))
                    if let finished = run.finishedAt {
                        DetailRow(label: "Finished", value: DateFormatting.formatAbsoluteTime(finished))
                    }
                }
                if let error = run.error {
                    InspectorSection(title: "Error") {
                        Text(error)
                            .font(.callout)
                            .foregroundStyle(.red)
                            .textSelection(.enabled)
                            .accessibilityLabel("Error")
                            .accessibilityValue(error)
                    }
                }
                InspectorSection(title: "CLI") {
                    cliRow("pop run inspect \(IdentifierFormatting.formatShortID(run.id))")
                    cliRow("pop run events \(IdentifierFormatting.formatShortID(run.id))")
                }
            }
            .padding()
        }
    }

    @ViewBuilder
    private var runActions: some View {
        let hasActions = MutationEligibility.canRetryRun(state: run.state)
            || MutationEligibility.canCancelRun(state: run.state)

        if hasActions {
            HStack(spacing: 8) {
                if MutationEligibility.canCancelRun(state: run.state) {
                    Button("Cancel", systemImage: "xmark.circle", role: .destructive) {
                        pendingMutation = .cancelRun(run.id)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .controlSize(.small)
                }
                if MutationEligibility.canRetryRun(state: run.state) {
                    Button("Retry", systemImage: "arrow.counterclockwise") {
                        pendingMutation = .retryRun(run.id)
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

    private func cliRow(_ command: String) -> some View {
        Text(command)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
            .padding(.vertical, 2)
            .accessibilityLabel("Command")
            .accessibilityValue(command)
    }
}
