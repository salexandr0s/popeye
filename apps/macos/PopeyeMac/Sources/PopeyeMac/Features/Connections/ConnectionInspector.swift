import SwiftUI
import PopeyeAPI

struct ConnectionInspector: View {
    let connection: ConnectionDTO

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                headerSection
                if let health = connection.health {
                    healthSection(health)
                }
                if let sync = connection.sync {
                    syncSection(sync)
                }
                if let policy = connection.policy {
                    policySection(policy)
                }
                timestampsSection
            }
            .padding()
        }
    }

    private var headerSection: some View {
        InspectorSection(title: "Connection") {
            DetailRow(label: "ID", value: connection.id)
            DetailRow(label: "Label", value: connection.label)
            DetailRow(label: "Domain", value: connection.domain)
            DetailRow(label: "Provider", value: connection.providerKind)
            DetailRow(label: "Mode", value: connection.mode)
            DetailRow(label: "Enabled", value: connection.enabled ? "Yes" : "No")
        }
    }

    private func healthSection(_ health: ConnectionHealthDTO) -> some View {
        InspectorSection(title: "Health") {
            DetailRow(label: "Status", value: health.status)
            DetailRow(label: "Auth State", value: health.authState)
            if let checked = health.checkedAt {
                DetailRow(label: "Checked", value: DateFormatting.formatAbsoluteTime(checked))
            }
            if let error = health.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
            if let rem = health.remediation {
                remediationRow(rem)
            }
        }
    }

    private func remediationRow(_ rem: ConnectionRemediationDTO) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Remediation")
                .font(.caption.bold())
                .foregroundStyle(.orange)
            DetailRow(label: "Action", value: rem.action)
            Text(rem.message)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func syncSection(_ sync: ConnectionSyncDTO) -> some View {
        InspectorSection(title: "Sync") {
            DetailRow(label: "Status", value: sync.status)
            DetailRow(label: "Lag", value: sync.lagSummary)
            if let lastAttempt = sync.lastAttemptAt {
                DetailRow(label: "Last Attempt", value: DateFormatting.formatAbsoluteTime(lastAttempt))
            }
            if let lastSuccess = sync.lastSuccessAt {
                DetailRow(label: "Last Success", value: DateFormatting.formatAbsoluteTime(lastSuccess))
            }
        }
    }

    private func policySection(_ policy: ConnectionPolicyDTO) -> some View {
        InspectorSection(title: "Policy") {
            DetailRow(label: "Status", value: policy.status)
            DetailRow(label: "Secret Status", value: policy.secretStatus)
            DetailRow(label: "Mutating Approval", value: policy.mutatingRequiresApproval ? "Required" : "Not required")
        }
    }

    private var timestampsSection: some View {
        InspectorSection(title: "Timestamps") {
            DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(connection.createdAt))
            DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(connection.updatedAt))
            if let lastSync = connection.lastSyncAt {
                DetailRow(label: "Last Sync", value: DateFormatting.formatAbsoluteTime(lastSync))
            }
        }
    }
}
