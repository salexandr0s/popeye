import SwiftUI
import PopeyeAPI

struct AutomationsView: View {
    @Bindable var store: AutomationStore
    @Environment(AppModel.self) private var appModel
    @State private var debouncer = ReloadDebouncer()

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
            if store.isLoading && store.automations.isEmpty {
                LoadingStateView(title: "Loading automations…")
            } else if let error = store.error, store.automations.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                content
            }
        }
        .navigationTitle("Automations")
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onChange(of: store.selectedAutomationID) { _, newValue in
            guard let newValue else { return }
            Task { try? await store.loadDetail(id: newValue) }
        }
        .onChange(of: store.filter) { _, _ in
            store.ensureSelection()
        }
        .onChange(of: store.searchText) { _, _ in
            store.ensureSelection()
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal,
               [.jobs, .runs, .interventions, .approvals, .general].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var content: some View {
        HSplitView {
            AutomationSidebarView(
                selectedAutomationID: $store.selectedAutomationID,
                filter: $store.filter,
                searchText: $store.searchText,
                automations: store.filteredAutomations
            )
            .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)

            VStack(alignment: .leading, spacing: 0) {
                header
                Divider()

                if store.viewMode == .week {
                    VSplitView {
                        AutomationWeekView(
                            automations: store.filteredAutomations,
                            selectedAutomationID: store.selectedAutomationID,
                            onSelect: { store.selectedAutomationID = $0 }
                        )
                        .frame(minHeight: 260)

                        if let selectedDetail {
                            AutomationDetailView(
                                detail: selectedDetail,
                                mutationReceipt: store.selectedMutationReceipt,
                                viewMode: store.viewMode,
                                update: { enabled, intervalSeconds in
                                    triggerUpdate(enabled: enabled, intervalSeconds: intervalSeconds)
                                },
                                runNow: { triggerRunNow() },
                                pause: { triggerPause() },
                                resume: { triggerResume() },
                                openRun: appModel.navigateToRun(id:)
                            )
                            .id(selectedDetail.id + "-" + String(selectedDetail.enabled) + "-" + String(selectedDetail.intervalSeconds ?? -1))
                        } else {
                            ContentUnavailableView("Select an automation", systemImage: "bolt.badge.clock")
                        }
                    }
                } else if let selectedDetail {
                    AutomationDetailView(
                        detail: selectedDetail,
                        mutationReceipt: store.selectedMutationReceipt,
                        viewMode: store.viewMode,
                        update: { enabled, intervalSeconds in
                            triggerUpdate(enabled: enabled, intervalSeconds: intervalSeconds)
                        },
                        runNow: { triggerRunNow() },
                        pause: { triggerPause() },
                        resume: { triggerResume() },
                        openRun: appModel.navigateToRun(id:)
                    )
                    .id(selectedDetail.id + "-" + String(selectedDetail.enabled) + "-" + String(selectedDetail.intervalSeconds ?? -1))
                } else {
                    ContentUnavailableView("Select an automation", systemImage: "bolt.badge.clock")
                }
            }
            .frame(minWidth: 560)
        }
        .overlay(alignment: .bottomTrailing) {
            mutationToast
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID)
                    .font(.headline)
                Text("Recurring work and heartbeat health for the current workspace")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Picker("View", selection: $store.viewMode) {
                ForEach(AutomationStore.ViewMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue.capitalized).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 180)
        }
        .padding(16)
        .background(.background.secondary)
    }

    @ViewBuilder
    private var mutationToast: some View {
        switch store.mutationState {
        case .idle:
            EmptyView()
        case .executing:
            ProgressView()
                .controlSize(.small)
                .padding(12)
                .background(.regularMaterial)
                .clipShape(Capsule())
                .padding(20)
        case .succeeded(let message), .failed(let message):
            Text(message)
                .font(.callout)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.regularMaterial)
                .clipShape(Capsule())
                .padding(20)
                .onTapGesture { store.dismissMutation() }
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
