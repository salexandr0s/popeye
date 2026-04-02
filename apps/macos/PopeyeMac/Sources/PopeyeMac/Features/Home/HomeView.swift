import SwiftUI
import PopeyeAPI

struct HomeView: View {
    @Bindable var store: HomeStore
    @Environment(AppModel.self) private var appModel
    @State private var debouncer = ReloadDebouncer()

    private let summaryColumns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    var body: some View {
        Group {
            if store.isLoading && store.summary == nil {
                LoadingStateView(title: "Loading home…")
            } else if let error = store.error, store.summary == nil {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        header
                        statusSummary
                        setupSummary
                        automationsSection
                        agendaSection
                        memorySection
                        ControlChangesSection(receipts: store.summary?.controlChanges ?? [])
                    }
                    .padding(20)
                }
            }
        }
        .navigationTitle("Home")
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal,
               [.general, .connections, .runs, .jobs, .memory, .security, .telegram, .approvals, .interventions].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID)
                .font(.title2.bold())
            Text("Your daily control center for setup health, recurring work, memory, and what needs attention next.")
                .font(.callout)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                Button("Setup", systemImage: "checklist", action: appModel.navigateToSetup)
                    .buttonStyle(.bordered)
                Button("Brain", systemImage: "brain.head.profile", action: appModel.navigateToBrain)
                    .buttonStyle(.bordered)
                Button("Automations", systemImage: "bolt.badge.clock", action: appModel.navigateToAutomations)
                    .buttonStyle(.borderedProminent)
                Button("Memory", systemImage: "brain") {
                    appModel.navigateToMemory(preferredMode: .daily)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private var statusSummary: some View {
        LazyVGrid(columns: summaryColumns, spacing: 12) {
            DashboardCard(
                label: "Daemon",
                value: store.summary?.status.ok == true ? "Healthy" : "Needs attention",
                description: store.summary?.capabilities.engineKind.uppercased(),
                valueColor: store.summary?.status.ok == true ? .green : .orange
            )
            DashboardCard(
                label: "Scheduler",
                value: store.summary?.scheduler.running == true ? "Running" : "Stopped",
                description: store.summary?.scheduler.nextHeartbeatDueAt.map(DateFormatting.formatRelativeTime) ?? "No heartbeat scheduled",
                valueColor: store.summary?.scheduler.running == true ? .green : .orange
            )
            DashboardCard(
                label: "Interventions",
                value: "\(store.summary?.status.openInterventions ?? 0)",
                description: (store.summary?.status.openInterventions ?? 0) == 0 ? "No open interventions" : "Operator action needed",
                valueColor: (store.summary?.status.openInterventions ?? 0) == 0 ? .green : .orange
            )
            DashboardCard(
                label: "Approvals",
                value: "\(store.summary?.pendingApprovalCount ?? appModel.badgeCounts.pendingApprovals)",
                description: (store.summary?.pendingApprovalCount ?? appModel.badgeCounts.pendingApprovals) == 0 ? "No pending approvals" : "Waiting for review",
                valueColor: (store.summary?.pendingApprovalCount ?? appModel.badgeCounts.pendingApprovals) == 0 ? .green : .orange
            )
        }
    }

    private var setupSummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Setup Status")
                .font(.headline)
                .foregroundStyle(.secondary)

            LazyVGrid(columns: summaryColumns, spacing: 12) {
                DashboardCard(
                    label: "Providers",
                    value: "\(store.supportedProviderCount)",
                    description: "GitHub, Gmail, Calendar, Telegram"
                )
                DashboardCard(
                    label: "Healthy",
                    value: "\(store.healthyProviderCount)",
                    description: "Ready for daily use",
                    valueColor: store.healthyProviderCount == store.supportedProviderCount ? .green : .primary
                )
                DashboardCard(
                    label: "Attention",
                    value: "\(store.attentionProviderCount)",
                    description: store.attentionProviderCount == 0 ? "No blockers visible" : "Reconnect or review setup",
                    valueColor: store.attentionProviderCount == 0 ? .green : .orange
                )
                DashboardCard(
                    label: "Telegram",
                    value: store.telegramStatusLabel,
                    description: store.summary?.setup.telegramEffectiveWorkspaceId.map { "Runtime-global → \($0)" } ?? "Runtime-global bridge",
                    valueColor: store.telegramStatusLabel == "Active" ? .green : .orange
                )
            }
        }
    }

    private var automationsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Automations")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Open Automations", action: appModel.navigateToAutomations)
                    .buttonStyle(.link)
            }

            if store.automationAttention.isEmpty, store.automationDueSoon.isEmpty {
                EmptyStateView(icon: "bolt.badge.clock", title: "No automation activity yet", description: "Recurring work will appear here once scheduler-backed tasks are running.")
            } else {
                InspectorSection(title: "Needs Attention") {
                    if store.automationAttention.isEmpty {
                        Text("No automations are currently blocked or waiting for operator action.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.automationAttention) { automation in
                            automationRow(automation)
                        }
                    }
                }

                InspectorSection(title: "Due Soon") {
                    ForEach(store.automationDueSoon) { automation in
                        automationRow(automation)
                    }
                }
            }
        }
    }

    private var agendaSection: some View {
        HStack(alignment: .top, spacing: 20) {
            InspectorSection(title: "Upcoming Calendar") {
                if let digest = store.summary?.calendarDigest {
                    DetailRow(label: "Today", value: "\(digest.todayEventCount)")
                    DetailRow(label: "Upcoming", value: "\(digest.upcomingCount)")
                }
                if store.summary?.upcomingEvents.isEmpty != false {
                    Text("No upcoming events loaded yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach((store.summary?.upcomingEvents ?? []).prefix(5)) { event in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.title)
                                .font(.headline)
                            Text(DateFormatting.formatAbsoluteTime(event.startTime))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Button("Open Calendar", action: appModel.navigateToCalendar)
                    .buttonStyle(.link)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)

            InspectorSection(title: "Upcoming Todos") {
                if let digest = store.summary?.todoDigest {
                    DetailRow(label: "Pending", value: "\(digest.pendingCount)")
                    DetailRow(label: "Overdue", value: "\(digest.overdueCount)")
                }
                if store.summary?.upcomingTodos.isEmpty != false {
                    Text("No active todos loaded yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach((store.summary?.upcomingTodos ?? []).prefix(5)) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(.headline)
                            Text(item.projectName ?? item.status.capitalized)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Button("Open Todos", action: appModel.navigateToTodos)
                    .buttonStyle(.link)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }

    private var memorySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recent Memory")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Open Memory") {
                    appModel.navigateToMemory(preferredMode: .daily)
                }
                .buttonStyle(.link)
            }

            if store.summary?.recentMemories.isEmpty != false {
                EmptyStateView(icon: "brain", title: "No recent memory yet", description: "Memories will appear here as Popeye captures daily activity and promoted knowledge.")
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach((store.summary?.recentMemories ?? []).prefix(6)) { memory in
                        Button {
                            appModel.navigateToMemory(id: memory.id, preferredMode: .daily)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(memory.description)
                                        .font(.headline)
                                        .multilineTextAlignment(.leading)
                                    Spacer()
                                    StatusBadge(state: memory.memoryType)
                                }
                                Text(memory.domain.capitalized)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(memory.sourceTimestamp ?? memory.createdAt)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(.background.secondary)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func automationRow(_ automation: AutomationRecordDTO) -> some View {
        Button {
            appModel.navigateToAutomations()
        } label: {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(automation.title)
                        .font(.headline)
                        .multilineTextAlignment(.leading)
                    Text(automation.attentionReason ?? automation.blockedReason ?? automation.scheduleSummary)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                StatusBadge(state: automation.status)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.background.secondary)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func reload() {
        Task { await store.load() }
    }
}
