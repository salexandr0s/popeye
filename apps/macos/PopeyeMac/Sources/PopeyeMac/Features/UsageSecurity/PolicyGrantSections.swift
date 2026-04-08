import SwiftUI
import PopeyeAPI

struct StandingApprovalsSection: View {
    @Bindable var store: UsageSecurityStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header(
                title: "Standing Approvals",
                description: "Durable operator grants that can auto-resolve eligible approval requests when policy allows."
            )

            summaryCards(
                total: store.standingApprovals.count,
                active: store.activeStandingApprovalCount,
                filtered: store.filteredStandingApprovals.count
            )

            PolicyGrantDraftForm(
                title: "Create standing approval",
                description: "Use the runtime’s existing policy schema. Resource type is required; all other fields are optional.",
                draft: $store.standingApprovalDraft,
                isSubmitting: store.isBusy(.createStandingApproval),
                submitLabel: store.isBusy(.createStandingApproval) ? "Creating…" : "Create standing approval",
                footerText: "Created as macos_app.",
                canSubmit: store.canCreateStandingApproval,
                submitAction: { Task { await store.createStandingApproval() } }
            )

            PolicyGrantFilterBar(
                status: $store.standingApprovalStatusFilter,
                domain: $store.standingApprovalDomainFilter,
                action: $store.standingApprovalActionFilter
            )

            OperationStatusView(
                phase: store.standingApprovalsPhase,
                loadingTitle: "Loading standing approvals…",
                failureTitle: "Couldn’t load standing approvals",
                retryAction: { Task { await store.refreshStandingApprovals() } }
            )

            if store.filteredStandingApprovals.isEmpty {
                EmptyStateView(
                    icon: "checkmark.shield",
                    title: "No standing approvals",
                    description: "Create one above or adjust the filters to see existing durable grants."
                )
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(store.filteredStandingApprovals) { record in
                        StandingApprovalRowCard(
                            record: record,
                            isBusy: store.isBusy(.revokeStandingApproval(record.id)),
                            revokeAction: record.status == "active"
                                ? { Task { await store.revokeStandingApproval(id: record.id) } }
                                : nil
                        )
                    }
                }
            }
        }
    }
}

struct AutomationGrantsSection: View {
    @Bindable var store: UsageSecurityStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header(
                title: "Automation Grants",
                description: "Allow unattended automation to satisfy matching approvals when the action policy marks them eligible."
            )

            summaryCards(
                total: store.automationGrants.count,
                active: store.activeAutomationGrantCount,
                filtered: store.filteredAutomationGrants.count
            )

            PolicyGrantDraftForm(
                title: "Create automation grant",
                description: "Native uses the runtime’s default task sources for now; this screen only configures the grant scope.",
                draft: $store.automationGrantDraft,
                isSubmitting: store.isBusy(.createAutomationGrant),
                submitLabel: store.isBusy(.createAutomationGrant) ? "Creating…" : "Create automation grant",
                footerText: "Created as macos_app. Task sources use the control API defaults.",
                canSubmit: store.canCreateAutomationGrant,
                submitAction: { Task { await store.createAutomationGrant() } }
            )

            PolicyGrantFilterBar(
                status: $store.automationGrantStatusFilter,
                domain: $store.automationGrantDomainFilter,
                action: $store.automationGrantActionFilter
            )

            OperationStatusView(
                phase: store.automationGrantsPhase,
                loadingTitle: "Loading automation grants…",
                failureTitle: "Couldn’t load automation grants",
                retryAction: { Task { await store.refreshAutomationGrants() } }
            )

            if store.filteredAutomationGrants.isEmpty {
                EmptyStateView(
                    icon: "bolt.badge.shield.checkered",
                    title: "No automation grants",
                    description: "Create one above or adjust the filters to see current unattended policy grants."
                )
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(store.filteredAutomationGrants) { record in
                        AutomationGrantRowCard(
                            record: record,
                            isBusy: store.isBusy(.revokeAutomationGrant(record.id)),
                            revokeAction: record.status == "active"
                                ? { Task { await store.revokeAutomationGrant(id: record.id) } }
                                : nil
                        )
                    }
                }
            }
        }
    }
}

private struct PolicyGrantDraftForm: View {
    let title: String
    let description: String
    @Binding var draft: UsageSecurityStore.PolicyGrantDraft
    let isSubmitting: Bool
    let submitLabel: String
    let footerText: String
    let canSubmit: Bool
    let submitAction: () -> Void

    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 180, maximum: 260)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
            Text(description)
                .font(.callout)
                .foregroundStyle(.secondary)

            LazyVGrid(columns: columns, spacing: 12) {
                Picker("Scope", selection: $draft.scope) {
                    ForEach(UsageSecurityStore.ApprovalScopeOption.allCases) { scope in
                        Text(scope.rawValue.humanizedForPolicyUI).tag(scope)
                    }
                }
                .pickerStyle(.menu)

                Picker("Domain", selection: $draft.domain) {
                    ForEach(UsageSecurityStore.DomainOption.allCases) { domain in
                        Text(domain.rawValue.humanizedForPolicyUI).tag(domain)
                    }
                }
                .pickerStyle(.menu)

                Picker("Action", selection: $draft.actionKind) {
                    ForEach(UsageSecurityStore.ActionOption.allCases) { action in
                        Text(action.rawValue.humanizedForPolicyUI).tag(action)
                    }
                }
                .pickerStyle(.menu)

                TextField("Resource type", text: $draft.resourceType)
                TextField("Resource ID", text: $draft.resourceId)
                TextField("Requested by", text: $draft.requestedBy)
                TextField("Workspace ID", text: $draft.workspaceId)
                TextField("Project ID", text: $draft.projectId)
                TextField("Expires at (ISO timestamp)", text: $draft.expiresAt)
            }

            TextField("Operator note", text: $draft.note, axis: .vertical)
                .lineLimit(3...6)

            HStack(spacing: 12) {
                Button(action: submitAction) {
                    if isSubmitting {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(submitLabel)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSubmit || isSubmitting)

                Text(footerText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PopeyeUI.contentPadding)
        .background(.background.secondary)
        .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
    }
}

private struct PolicyGrantFilterBar: View {
    @Binding var status: UsageSecurityStore.StatusFilter
    @Binding var domain: UsageSecurityStore.DomainOption?
    @Binding var action: UsageSecurityStore.ActionOption?

    var body: some View {
        HStack(spacing: 12) {
            Picker("Status", selection: $status) {
                ForEach(UsageSecurityStore.StatusFilter.allCases) { filter in
                    Text(filter.rawValue.humanizedForPolicyUI).tag(filter)
                }
            }
            .pickerStyle(.menu)
            .frame(width: 150)

            Picker("Domain", selection: $domain) {
                Text("All domains").tag(UsageSecurityStore.DomainOption?.none)
                Divider()
                ForEach(UsageSecurityStore.DomainOption.allCases) { option in
                    Text(option.rawValue.humanizedForPolicyUI).tag(Optional(option))
                }
            }
            .pickerStyle(.menu)
            .frame(width: 170)

            Picker("Action", selection: $action) {
                Text("All actions").tag(UsageSecurityStore.ActionOption?.none)
                Divider()
                ForEach(UsageSecurityStore.ActionOption.allCases) { option in
                    Text(option.rawValue.humanizedForPolicyUI).tag(Optional(option))
                }
            }
            .pickerStyle(.menu)
            .frame(width: 180)

            Spacer()
        }
    }
}

private struct StandingApprovalRowCard: View {
    let record: StandingApprovalRecordDTO
    let isBusy: Bool
    let revokeAction: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(record.resourceType)
                        .font(.headline)
                    Text("\(record.scope.humanizedForPolicyUI) • \(record.domain.humanizedForPolicyUI) • \(record.actionKind.humanizedForPolicyUI)")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                StatusBadge(state: record.status)
            }

            detailsGrid(
                resourceValue: record.resourceId ?? "*",
                requesterValue: record.requestedBy ?? "*",
                contextValue: contextLabel(workspaceId: record.workspaceId, projectId: record.projectId),
                noteValue: record.note.isEmpty ? "—" : record.note,
                createdAt: record.createdAt,
                expiresAt: record.expiresAt,
                createdBy: record.createdBy,
                revokedBy: record.revokedBy
            )

            if let revokeAction {
                HStack {
                    Spacer()
                    Button(action: revokeAction) {
                        if isBusy {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(isBusy ? "Revoking…" : "Revoke")
                    }
                    .buttonStyle(.bordered)
                    .disabled(isBusy)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(.background)
        .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
        .overlay {
            RoundedRectangle(cornerRadius: PopeyeUI.cardCornerRadius)
                .strokeBorder(.separator, lineWidth: 0.5)
        }
    }
}

private struct AutomationGrantRowCard: View {
    let record: AutomationGrantRecordDTO
    let isBusy: Bool
    let revokeAction: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(record.resourceType)
                        .font(.headline)
                    Text("\(record.scope.humanizedForPolicyUI) • \(record.domain.humanizedForPolicyUI) • \(record.actionKind.humanizedForPolicyUI)")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                StatusBadge(state: record.status)
            }

            detailsGrid(
                resourceValue: record.resourceId ?? "*",
                requesterValue: record.requestedBy ?? "*",
                contextValue: contextLabel(workspaceId: record.workspaceId, projectId: record.projectId),
                noteValue: record.note.isEmpty ? "—" : record.note,
                createdAt: record.createdAt,
                expiresAt: record.expiresAt,
                createdBy: record.createdBy,
                revokedBy: record.revokedBy,
                taskSources: record.taskSources.isEmpty ? "Default" : record.taskSources.joined(separator: ", ")
            )

            if let revokeAction {
                HStack {
                    Spacer()
                    Button(action: revokeAction) {
                        if isBusy {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(isBusy ? "Revoking…" : "Revoke")
                    }
                    .buttonStyle(.bordered)
                    .disabled(isBusy)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(.background)
        .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
        .overlay {
            RoundedRectangle(cornerRadius: PopeyeUI.cardCornerRadius)
                .strokeBorder(.separator, lineWidth: 0.5)
        }
    }
}

@ViewBuilder
private func detailsGrid(
    resourceValue: String,
    requesterValue: String,
    contextValue: String,
    noteValue: String,
    createdAt: String,
    expiresAt: String?,
    createdBy: String,
    revokedBy: String?,
    taskSources: String? = nil
) -> some View {
    let columns = PopeyeUI.cardColumns(minimum: 180, maximum: 280)
    LazyVGrid(columns: columns, spacing: 8) {
        detailCell(label: "Resource", value: resourceValue)
        detailCell(label: "Requested By", value: requesterValue)
        detailCell(label: "Scope", value: contextValue)
        if let taskSources {
            detailCell(label: "Task Sources", value: taskSources)
        }
        detailCell(label: "Created", value: DateFormatting.formatRelativeTime(createdAt))
        detailCell(label: "Expires", value: formattedOptionalTimestamp(expiresAt))
        detailCell(label: "Created By", value: createdBy)
        detailCell(label: "Revoked By", value: revokedBy ?? "—")
        detailCell(label: "Note", value: noteValue)
    }
}

private func summaryCards(total: Int, active: Int, filtered: Int) -> some View {
    LazyVGrid(columns: PopeyeUI.cardColumns(minimum: 140, maximum: 220), spacing: PopeyeUI.cardSpacing) {
        DashboardCard(label: "Total", value: "\(total)")
        DashboardCard(label: "Active", value: "\(active)", valueColor: active > 0 ? .green : .secondary)
        DashboardCard(label: "Filtered", value: "\(filtered)")
    }
}

private func header(title: String, description: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        Text(title)
            .font(.title3.weight(.semibold))
        Text(description)
            .font(.callout)
            .foregroundStyle(.secondary)
    }
}

private func detailCell(label: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(label)
            .font(.caption)
            .foregroundStyle(.secondary)
        Text(value)
            .font(.callout)
            .textSelection(.enabled)
            .multilineTextAlignment(.leading)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(10)
    .background(.background.secondary)
    .clipShape(.rect(cornerRadius: 10))
}

private func contextLabel(workspaceId: String?, projectId: String?) -> String {
    let workspace = workspaceId ?? "*"
    let project = projectId ?? "*"
    return "\(workspace) / \(project)"
}

private func formattedOptionalTimestamp(_ value: String?) -> String {
    guard let value, value.isEmpty == false else { return "—" }
    return DateFormatting.formatAbsoluteTime(value)
}
