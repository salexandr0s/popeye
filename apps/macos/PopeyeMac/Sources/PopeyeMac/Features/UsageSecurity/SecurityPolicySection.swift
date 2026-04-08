import SwiftUI
import PopeyeAPI

struct SecurityPolicySection: View {
    let policy: SecurityPolicyResponseDTO?
    let phase: ScreenOperationPhase
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Security Policy")
                    .font(.title3.weight(.semibold))
                Text("Read-only policy posture for domains, approval rules, and action defaults.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            OperationStatusView(
                phase: phase,
                loadingTitle: "Loading security policy…",
                failureTitle: "Couldn’t load security policy",
                retryAction: retry
            )

            if let policy {
                LazyVGrid(columns: PopeyeUI.cardColumns(minimum: 160, maximum: 240), spacing: PopeyeUI.cardSpacing) {
                    DashboardCard(label: "Default Risk", value: policy.defaultRiskClass.humanizedForPolicyUI)
                    DashboardCard(label: "Domain Policies", value: "\(policy.domainPolicies.count)")
                    DashboardCard(label: "Approval Rules", value: "\(policy.approvalRules.count)")
                    DashboardCard(label: "Action Defaults", value: "\(policy.actionDefaults.count)")
                }

                InspectorSection(title: "Domain Policies") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(policy.domainPolicies, id: \.domain) { entry in
                            policyCard(title: entry.domain.humanizedForPolicyUI) {
                                DetailRow(label: "Sensitivity", value: entry.sensitivity.humanizedForPolicyUI)
                                DetailRow(label: "Embedding", value: entry.embeddingPolicy.humanizedForPolicyUI)
                                DetailRow(label: "Context Release", value: entry.contextReleasePolicy.humanizedForPolicyUI)
                            }
                        }
                    }
                }

                InspectorSection(title: "Action Defaults") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(policy.actionDefaults, id: \.id) { entry in
                            policyCard(title: "\(entry.scope.humanizedForPolicyUI) • \(entry.actionKind.humanizedForPolicyUI)") {
                                DetailRow(label: "Domain", value: (entry.domain ?? "all").humanizedForPolicyUI)
                                DetailRow(label: "Risk", value: entry.riskClass.humanizedForPolicyUI)
                                DetailRow(label: "Standing Approval", value: entry.standingApprovalEligible ? "Eligible" : "Not eligible")
                                DetailRow(label: "Automation Grant", value: entry.automationGrantEligible ? "Eligible" : "Not eligible")
                                DetailRow(label: "Reason", value: entry.reason)
                            }
                        }
                    }
                }

                InspectorSection(title: "Approval Rules") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(policy.approvalRules, id: \.id) { rule in
                            policyCard(title: "\(rule.scope.humanizedForPolicyUI) • \(rule.domain.humanizedForPolicyUI)") {
                                DetailRow(label: "Risk", value: rule.riskClass.humanizedForPolicyUI)
                                DetailRow(label: "Actions", value: rule.actionKinds.isEmpty ? "Any" : rule.actionKinds.map(\.humanizedForPolicyUI).joined(separator: ", "))
                                DetailRow(label: "Resource Scopes", value: rule.resourceScopes.isEmpty ? "Any" : rule.resourceScopes.map(\.humanizedForPolicyUI).joined(separator: ", "))
                            }
                        }
                    }
                }
            } else if !phase.isLoading {
                EmptyStateView(
                    icon: "checkmark.shield",
                    title: "No security policy loaded",
                    description: "Refresh to load the domain policies, action defaults, and approval rules from the runtime."
                )
            }
        }
    }
}

private func policyCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 8) {
        Text(title)
            .font(.headline)
        content()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(PopeyeUI.contentPadding)
    .background(.background)
    .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
    .overlay {
        RoundedRectangle(cornerRadius: PopeyeUI.cardCornerRadius)
            .strokeBorder(.separator, lineWidth: 0.5)
    }
}

private extension ActionPolicyDefaultDTO {
    var id: String {
        [scope, domain ?? "all", actionKind].joined(separator: ":")
    }
}

private extension ApprovalPolicyRuleDTO {
    var id: String {
        [scope, domain, riskClass].joined(separator: ":")
    }
}
