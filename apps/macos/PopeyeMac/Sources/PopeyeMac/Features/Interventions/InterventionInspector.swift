import SwiftUI
import PopeyeAPI

struct InterventionInspector: View {
    let intervention: InterventionDTO
    let store: InterventionsStore
    @Environment(AppModel.self) private var appModel

    @State private var pendingAction: Action?
    @State private var resolutionNote = ""

    enum Action: Identifiable {
        case resolve
        var id: String { "resolve" }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                mutationToast
                InterventionActionsSection(status: intervention.status, store: store, pendingAction: $pendingAction)
                headerSection
                reasonSection
                if let runId = intervention.runId {
                    relatedSection(runId: runId)
                }
                timestampsSection
                if let note = intervention.resolutionNote {
                    resolutionSection(note: note)
                }
            }
            .padding()
        }
        .sheet(item: $pendingAction) { _ in
            InterventionConfirmationSheet(
                interventionId: intervention.id,
                pendingAction: $pendingAction,
                resolutionNote: $resolutionNote,
                store: store
            )
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
        InspectorSection(title: "Intervention") {
            CopyableRow(label: "ID", value: intervention.id)
            DetailRow(label: "Code", value: intervention.code)
            DetailRow(label: "Status", value: intervention.status)
        }
    }

    private var reasonSection: some View {
        InspectorSection(title: "Reason") {
            Text(intervention.reason)
                .font(.callout)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func relatedSection(runId: String) -> some View {
        InspectorSection(title: "Related") {
            NavigableIDRow(label: "Run ID", id: runId) {
                appModel.navigateToRun(id: runId)
            }
        }
    }

    private var timestampsSection: some View {
        InspectorSection(title: "Timestamps") {
            DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(intervention.createdAt))
            if let resolved = intervention.resolvedAt {
                DetailRow(label: "Resolved", value: DateFormatting.formatAbsoluteTime(resolved))
            }
            if let updated = intervention.updatedAt {
                DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(updated))
            }
        }
    }

    private func resolutionSection(note: String) -> some View {
        InspectorSection(title: "Resolution Note") {
            Text(note)
                .font(.callout)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(.background)
                .clipShape(.rect(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(.separator, lineWidth: 0.5)
                )
                .accessibilityLabel("Resolution note")
                .accessibilityValue(note)
        }
    }
}
