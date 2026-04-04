import SwiftUI
import PopeyeAPI

struct AutomationsView: View {
    @Bindable var store: AutomationStore
    @Environment(AppModel.self) private var appModel

    private var selectedDetail: AutomationDetailDTO? {
        guard let selectedAutomationID = store.selectedAutomationID else { return nil }
        if store.selectedDetail?.id == selectedAutomationID {
            return store.selectedDetail
        }
        return store.filteredAutomations.first(where: { $0.id == selectedAutomationID }).map { automation in
            AutomationDetailDTO(
                id: automation.id,
                workspaceId: automation.workspaceId,
                taskId: automation.taskId,
                source: automation.source,
                title: automation.title,
                taskStatus: automation.taskStatus,
                jobId: automation.jobId,
                jobStatus: automation.jobStatus,
                status: automation.status,
                enabled: automation.enabled,
                scheduleSummary: automation.scheduleSummary,
                intervalSeconds: automation.intervalSeconds,
                lastRunAt: automation.lastRunAt,
                lastSuccessAt: automation.lastSuccessAt,
                lastFailureAt: automation.lastFailureAt,
                nextExpectedAt: automation.nextExpectedAt,
                blockedReason: automation.blockedReason,
                attentionReason: automation.attentionReason,
                openInterventionCount: automation.openInterventionCount,
                pendingApprovalCount: automation.pendingApprovalCount,
                controls: automation.controls,
                recentRuns: []
            )
        }
    }

    var body: some View {
        Group {
            if store.loadPhase == .loading && store.automations.isEmpty {
                LoadingStateView(title: "Loading automations…")
            } else if let error = store.error, store.automations.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                HSplitView {
                    AutomationSidebarView(
                        selectedAutomationID: $store.selectedAutomationID,
                        filter: $store.filter,
                        automations: store.filteredAutomations
                    )
                    .popeyeSplitPane(minWidth: 280, idealWidth: 320, maxWidth: 360)

                    AutomationsContentPane(
                        store: store,
                        workspaceName: appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID,
                        selectedDetail: selectedDetail,
                        update: { enabled, intervalSeconds in
                            triggerUpdate(enabled: enabled, intervalSeconds: intervalSeconds)
                        },
                        runNow: { triggerRunNow() },
                        pause: { triggerPause() },
                        resume: { triggerResume() },
                        openRun: appModel.navigateToRun(id:)
                    )
                    .popeyeSplitPane(minWidth: 560)
                }
                .overlay(alignment: .bottomTrailing) {
                    MutationStateOverlay(state: store.mutationState, dismiss: store.dismissMutation)
                        .padding(20)
                }
            }
        }
        .navigationTitle("Automations")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Search automations…")
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onChange(of: store.selectedAutomationID) { _, newValue in
            guard let newValue else { return }
            Task { await store.loadDetail(id: newValue) }
        }
        .onChange(of: store.filter) { _, _ in
            store.ensureSelection()
        }
        .onChange(of: store.searchText) { _, _ in
            store.ensureSelection()
        }
        .popeyeRefreshable(invalidationSignals: [.jobs, .runs, .interventions, .approvals, .general]) {
            await store.load()
        }
    }

    private func reload() {
        Task { await store.load() }
    }

    private func triggerUpdate(enabled: Bool?, intervalSeconds: Int?) {
        guard let selectedAutomationID = store.selectedAutomationID else { return }
        Task { await store.update(id: selectedAutomationID, enabled: enabled, intervalSeconds: intervalSeconds) }
    }

    private func triggerRunNow() {
        guard let selectedAutomationID = store.selectedAutomationID else { return }
        Task { await store.runNow(id: selectedAutomationID) }
    }

    private func triggerPause() {
        guard let selectedAutomationID = store.selectedAutomationID else { return }
        Task { await store.pause(id: selectedAutomationID) }
    }

    private func triggerResume() {
        guard let selectedAutomationID = store.selectedAutomationID else { return }
        Task { await store.resume(id: selectedAutomationID) }
    }
}
