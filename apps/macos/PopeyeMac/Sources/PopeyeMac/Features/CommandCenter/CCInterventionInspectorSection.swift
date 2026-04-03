import SwiftUI
import PopeyeAPI

struct CCInterventionInspectorSection: View {
    let intervention: InterventionDTO
    let store: CommandCenterStore
    @Binding var pendingMutation: CommandCenterInspector.PendingMutation?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                mutationToast
                interventionActions
                InspectorSection(title: "Intervention") {
                    DetailRow(label: "Code", value: intervention.code)
                    DetailRow(label: "Status", value: intervention.status)
                    DetailRow(label: "Reason", value: intervention.reason)
                    DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(intervention.createdAt))
                    if let resolved = intervention.resolvedAt {
                        DetailRow(label: "Resolved", value: DateFormatting.formatAbsoluteTime(resolved))
                    }
                }
                if let runId = intervention.runId {
                    InspectorSection(title: "Related") {
                        DetailRow(label: "Run ID", value: IdentifierFormatting.formatShortID(runId))
                    }
                }
                if let note = intervention.resolutionNote {
                    InspectorSection(title: "Resolution") {
                        Text(note)
                            .font(.callout)
                            .textSelection(.enabled)
                            .accessibilityLabel("Resolution note")
                            .accessibilityValue(note)
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
    private var interventionActions: some View {
        if MutationEligibility.canResolveIntervention(status: intervention.status) {
            HStack(spacing: 8) {
                Button("Resolve", systemImage: "checkmark.circle") {
                    pendingMutation = .resolveIntervention(intervention.id)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .controlSize(.small)

                if store.mutationState == .executing {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .disabled(store.mutationState == .executing)
        }
    }
}
