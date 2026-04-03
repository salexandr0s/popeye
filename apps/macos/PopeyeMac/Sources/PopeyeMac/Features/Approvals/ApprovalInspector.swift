import SwiftUI
import PopeyeAPI

struct ApprovalInspector: View {
    let approval: ApprovalDTO
    let store: ApprovalsStore

    @State private var pendingDecision: Decision?
    @State private var decisionReason = ""

    enum Decision: String, Identifiable {
        case approved, denied
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                mutationToast
                ApprovalActionsSection(status: approval.status, store: store, pendingDecision: $pendingDecision)
                requestSection
                resourceSection
                decisionSection
                timestampsSection
            }
            .padding()
        }
        .sheet(item: $pendingDecision) { decision in
            ApprovalConfirmationSheet(
                decision: decision,
                approvalId: approval.id,
                pendingDecision: $pendingDecision,
                decisionReason: $decisionReason,
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

    private var requestSection: some View {
        InspectorSection(title: "Request") {
            CopyableRow(label: "Approval ID", value: approval.id)
            DetailRow(label: "Scope", value: approval.scope)
            DetailRow(label: "Domain", value: approval.domain)
            DetailRow(label: "Risk Class", value: approval.riskClass)
            DetailRow(label: "Action Kind", value: approval.actionKind)
            DetailRow(label: "Requester", value: approval.requestedBy)
            if let runId = approval.runId {
                DetailRow(label: "Run ID", value: IdentifierFormatting.formatShortID(runId))
            }
        }
    }

    private var resourceSection: some View {
        InspectorSection(title: "Resource") {
            DetailRow(label: "Resource Scope", value: approval.resourceScope)
            DetailRow(label: "Resource Type", value: approval.resourceType)
            DetailRow(label: "Resource ID", value: approval.resourceId)
            if !approval.payloadPreview.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Payload Preview")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    Text(approval.payloadPreview)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Payload preview")
                .accessibilityValue(approval.payloadPreview)
            }
        }
    }

    private var decisionSection: some View {
        InspectorSection(title: "Decision") {
            DetailRow(label: "Status", value: approval.status)
            if let resolvedBy = approval.resolvedBy {
                DetailRow(label: "Resolved By", value: resolvedBy)
            }
            if let reason = approval.decisionReason {
                DetailRow(label: "Reason", value: reason)
            }
            if let grantId = approval.resolvedByGrantId {
                DetailRow(label: "Grant ID", value: IdentifierFormatting.formatShortID(grantId))
            }
            flagsRow
        }
    }

    private var flagsRow: some View {
        HStack(spacing: 12) {
            flagPill("Standing Eligible", active: approval.standingApprovalEligible)
            flagPill("Automation Eligible", active: approval.automationGrantEligible)
        }
        .padding(.top, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Eligibility")
        .accessibilityValue(eligibilitySummary)
    }

    private func flagPill(_ label: String, active: Bool) -> some View {
        Text(label)
            .font(.caption)
            .foregroundStyle(active ? .green : .secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(active ? Color.green.opacity(0.1) : Color.secondary.opacity(0.05))
            .clipShape(.capsule)
    }

    private var timestampsSection: some View {
        InspectorSection(title: "Timestamps") {
            DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(approval.createdAt))
            if let resolved = approval.resolvedAt {
                DetailRow(label: "Resolved", value: DateFormatting.formatAbsoluteTime(resolved))
            }
            if let expires = approval.expiresAt {
                DetailRow(label: "Expires", value: DateFormatting.formatAbsoluteTime(expires))
            }
        }
    }

    private var eligibilitySummary: String {
        [
            "Standing approval \(approval.standingApprovalEligible ? "eligible" : "not eligible")",
            "Automation \(approval.automationGrantEligible ? "eligible" : "not eligible")"
        ].joined(separator: ", ")
    }
}
