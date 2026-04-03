import SwiftUI
import PopeyeAPI

struct HomeView: View {
    @Bindable var store: HomeStore
    @Environment(AppModel.self) private var appModel

    var body: some View {
        Group {
            if store.isLoading && store.summary == nil {
                LoadingStateView(title: "Loading home…")
            } else if let error = store.error, store.summary == nil {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                        HomeHeaderSection(
                            workspaceName: appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID,
                            openSetup: appModel.navigateToSetup,
                            openBrain: appModel.navigateToBrain,
                            openAutomations: appModel.navigateToAutomations,
                            openMemory: openMemoryDaily
                        )
                        HomeStatusSummarySection(
                            summary: store.summary,
                            pendingApprovalCount: store.summary?.pendingApprovalCount ?? appModel.badgeCounts.pendingApprovals
                        )
                        HomeSetupSummarySection(
                            supportedProviderCount: store.supportedProviderCount,
                            healthyProviderCount: store.healthyProviderCount,
                            attentionProviderCount: store.attentionProviderCount,
                            telegramStatusLabel: store.telegramStatusLabel,
                            telegramEffectiveWorkspaceID: store.summary?.setup.telegramEffectiveWorkspaceId
                        )
                        HomeAutomationsSection(
                            automationAttention: store.automationAttention,
                            automationDueSoon: store.automationDueSoon,
                            openAutomations: appModel.navigateToAutomations
                        )
                        HomeAgendaSection(
                            summary: store.summary,
                            openCalendar: appModel.navigateToCalendar,
                            openTodos: appModel.navigateToTodos
                        )
                        HomeMemorySection(
                            recentMemories: store.summary?.recentMemories ?? [],
                            openMemory: openMemory
                        )
                        ControlChangesSection(receipts: store.summary?.controlChanges ?? [])
                    }
                    .padding(PopeyeUI.contentPadding)
                }
            }
        }
        .navigationTitle("Home")
        .popeyeRefreshable(
            invalidationSignals: [.general, .connections, .runs, .jobs, .memory, .security, .telegram, .approvals, .interventions]
        ) {
            await store.load()
        }
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
    }

    private func reload() {
        Task {
            await store.load()
        }
    }

    private func openMemoryDaily() {
        appModel.navigateToMemory(preferredMode: .daily)
    }

    private func openMemory(_ id: String?) {
        appModel.navigateToMemory(id: id, preferredMode: .daily)
    }
}
