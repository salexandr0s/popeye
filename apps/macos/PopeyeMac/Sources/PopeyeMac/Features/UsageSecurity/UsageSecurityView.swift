import SwiftUI
import PopeyeAPI

struct UsageSecurityView: View {
    @Bindable var store: UsageSecurityStore

    var body: some View {
        Group {
            if store.isLoading && store.usage == nil && store.controlChanges.isEmpty && store.standingApprovals.isEmpty && store.automationGrants.isEmpty && store.vaults.isEmpty {
                LoadingStateView(title: "Loading usage & security...")
            } else {
                usageSecurityContent
            }
        }
        .navigationTitle("Usage & Security")
        .task {
            await store.load()
        }
        .popeyeRefreshable(invalidationSignals: [.security, .approvals, .receipts, .general]) {
            await store.load()
        }
    }

    private var usageSecurityContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                UsageSection(usage: store.usage)
                SecuritySection(audit: store.securityAudit)
                ControlChangesSection(receipts: store.controlChanges)
                StandingApprovalsSection(store: store)
                AutomationGrantsSection(store: store)
                SecurityPolicySection(
                    policy: store.securityPolicy,
                    phase: store.securityPolicyPhase,
                    retry: { Task { await store.refreshSecurityPolicy() } }
                )
                VaultSummarySection(
                    vaults: store.vaults,
                    phase: store.vaultsPhase,
                    retry: { Task { await store.refreshVaults() } }
                )
            }
            .padding(PopeyeUI.contentPadding)
        }
        .overlay(alignment: .bottomTrailing) {
            MutationStateOverlay(state: store.mutationState, dismiss: store.dismissMutation)
                .padding(20)
        }
    }
}
