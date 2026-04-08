import SwiftUI
import PopeyeAPI

struct ConnectionInspector: View {
    @Bindable var store: ConnectionsStore
    let connection: ConnectionDTO

    private var diagnostics: ConnectionDiagnosticsDTO? {
        store.diagnostics
    }

    private var health: ConnectionHealthDTO {
        diagnostics?.health ?? connection.health ?? ConnectionHealthDTO(
            status: "unknown",
            authState: "unknown",
            checkedAt: nil,
            lastError: nil,
            remediation: nil
        )
    }

    private var policy: ConnectionPolicyDTO {
        diagnostics?.policy ?? connection.policy ?? ConnectionPolicyDTO(
            status: "ready",
            secretStatus: "not_required",
            mutatingRequiresApproval: false
        )
    }

    private var sync: ConnectionSyncDTO {
        diagnostics?.sync ?? connection.sync ?? ConnectionSyncDTO(
            lastAttemptAt: nil,
            lastSuccessAt: nil,
            status: "idle",
            lagSummary: "No sync summary"
        )
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                headerSection

                if store.detailPhase.isLoading {
                    OperationStatusView(
                        phase: .loading,
                        loadingTitle: "Loading resource rules and diagnostics…",
                        failureTitle: "Couldn’t load connection details."
                    )
                } else if let detailError = store.detailError {
                    OperationStatusView(
                        phase: .failed(detailError),
                        loadingTitle: "Loading connection details…",
                        failureTitle: "Couldn’t load connection details.",
                        retryAction: retryDetails
                    )
                }

                healthSection
                syncSection
                policySection
                resourceRulesSection
                diagnosticsSection
                timestampsSection
            }
            .padding(PopeyeUI.contentPadding)
        }
        .background(.background.secondary)
        .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(connection.label)
                    .font(.title3.weight(.semibold))
                Text("\(connection.domain) • \(providerTitle)")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                StatusBadge(state: health.status)
                StatusBadge(state: sync.status)
                if connection.enabled {
                    StatusBadge(state: "enabled")
                } else {
                    StatusBadge(state: "disabled")
                }
            }

            HStack(spacing: 10) {
                Button(connection.enabled ? "Disable" : "Enable") {
                    Task { await store.toggleSelectedConnectionEnabled() }
                }
                .buttonStyle(.bordered)
                .disabled(store.busyKey != nil)

                if store.supportsManualSync(for: connection) {
                    Button(store.isBusy(.sync(connection.id)) ? "Syncing…" : "Sync") {
                        Task { await store.syncSelectedConnection() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(store.busyKey != nil)
                }

                if let provider = store.oauthProvider(for: connection) {
                    Button(store.isBusy(.connect(provider.rawValue)) ? "\(store.browserReconnectLabel(for: connection))…" : store.browserReconnectLabel(for: connection)) {
                        Task { await store.connect(provider, connectionId: connection.id) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(store.busyKey != nil)
                }
            }
        }
    }

    private var healthSection: some View {
        InspectorSection(title: "Health") {
            DetailRow(label: "Status", value: health.status)
            DetailRow(label: "Auth State", value: health.authState)
            if let checkedAt = health.checkedAt {
                DetailRow(label: "Checked", value: DateFormatting.formatAbsoluteTime(checkedAt))
            }
            if let lastError = health.lastError, !lastError.isEmpty {
                Text(lastError)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .textSelection(.enabled)
            }
            if let remediation = health.remediation {
                remediationBlock(remediation)
            }
        }
    }

    private var syncSection: some View {
        InspectorSection(title: "Sync") {
            DetailRow(label: "Status", value: sync.status)
            DetailRow(label: "Lag", value: sync.lagSummary)
            if let lastAttemptAt = sync.lastAttemptAt {
                DetailRow(label: "Last Attempt", value: DateFormatting.formatAbsoluteTime(lastAttemptAt))
            }
            if let lastSuccessAt = sync.lastSuccessAt {
                DetailRow(label: "Last Success", value: DateFormatting.formatAbsoluteTime(lastSuccessAt))
            }
        }
    }

    private var policySection: some View {
        InspectorSection(title: "Policy") {
            DetailRow(label: "Status", value: policy.status)
            DetailRow(label: "Secret Status", value: policy.secretStatus)
            DetailRow(
                label: "Mutating Approval",
                value: policy.mutatingRequiresApproval ? "Required" : "Not required"
            )
            if let diagnostics = policy.diagnostics, !diagnostics.isEmpty {
                diagnosticsList(diagnostics)
            }
        }
    }

    private var resourceRulesSection: some View {
        InspectorSection(title: "Resource Rules") {
            if store.selectedResourceRules.isEmpty {
                Text("No resource rules configured for this connection.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(store.selectedResourceRules) { rule in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(rule.displayName)
                                        .font(.callout.weight(.medium))
                                    Text("\(rule.resourceType) • \(rule.resourceId)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if rule.writeAllowed {
                                    StatusBadge(state: "write_allowed")
                                } else {
                                    Text("Read-only")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Button(store.isBusy(.removeRule(rule.id)) ? "Removing…" : "Remove") {
                                    Task { await store.removeRule(rule) }
                                }
                                .buttonStyle(.bordered)
                                .disabled(store.busyKey != nil)
                            }
                        }
                        .padding(10)
                        .background(Color.primary.opacity(0.04))
                        .clipShape(.rect(cornerRadius: 10))
                    }
                }
            }

            Divider()
                .padding(.vertical, 4)

            VStack(alignment: .leading, spacing: 10) {
                Text("Add Rule")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                Picker("Resource Type", selection: $store.ruleDraft.resourceType) {
                    ForEach(ConnectionsStore.ResourceRuleType.allCases) { kind in
                        Text(kind.rawValue).tag(kind)
                    }
                }

                TextField("Resource ID", text: $store.ruleDraft.resourceId)
                    .textFieldStyle(.roundedBorder)
                TextField("Display Name", text: $store.ruleDraft.displayName)
                    .textFieldStyle(.roundedBorder)

                Toggle("Write allowed", isOn: $store.ruleDraft.writeAllowed)

                Button(store.isBusy(.addRule) ? "Adding…" : "Add Rule") {
                    Task { await store.addRule() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!store.canAddRule || store.busyKey != nil)
            }
        }
    }

    private var diagnosticsSection: some View {
        InspectorSection(title: "Diagnostics") {
            if let summary = diagnostics?.humanSummary, !summary.isEmpty {
                Text(summary)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                Text("Detailed diagnostics will appear here when the daemon exposes additional remediation context for this connection.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            if let healthDiagnostics = health.diagnostics, !healthDiagnostics.isEmpty {
                diagnosticsList(healthDiagnostics)
            }

            if health.remediation != nil || diagnostics?.remediation != nil {
                Button(store.isBusy(.reconnect(connection.id)) ? "Reconnecting…" : "Run Remediation") {
                    Task { await store.reconnectSelectedConnection() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.busyKey != nil)
            }
        }
    }

    private var timestampsSection: some View {
        InspectorSection(title: "Timestamps") {
            DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(connection.createdAt))
            DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(connection.updatedAt))
            if let lastSyncAt = connection.lastSyncAt {
                DetailRow(label: "Last Sync", value: DateFormatting.formatAbsoluteTime(lastSyncAt))
            }
        }
    }

    private var providerTitle: String {
        store.oauthProvider(for: connection)?.title ?? connection.providerKind
    }

    private func remediationBlock(_ remediation: ConnectionRemediationDTO) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Remediation")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
            DetailRow(label: "Action", value: remediation.action)
            Text(remediation.message)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func diagnosticsList(_ items: [ConnectionDiagnosticDTO]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(items) { diagnostic in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(diagnostic.severity.uppercased()) • \(diagnostic.code)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(diagnostic.severity == "error" ? .red : .orange)
                    Text(diagnostic.message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(10)
        .background(Color.primary.opacity(0.04))
        .clipShape(.rect(cornerRadius: 10))
    }

    private func retryDetails() {
        Task { await store.loadSelectedConnectionContext() }
    }
}
