import SwiftUI
import PopeyeAPI

struct DashboardView: View {
    var store: DashboardStore
    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 200, maximum: 280)
    }

    var body: some View {
        Group {
            switch store.loadingState {
            case .idle, .loading:
                LoadingStateView(title: "Loading dashboard…")
            case .loaded:
                dashboardContent
            case .failed(let error):
                ErrorStateView(error: error, retryAction: reload)
            }
        }
        .navigationTitle("Dashboard")
        .popeyeRefreshable(invalidationSignals: [.runs, .jobs, .security, .general]) {
            await store.refresh()
        }
        .task {
            await store.load()
            store.startPolling()
        }
        .onDisappear {
            store.stopPolling()
        }
    }

    @ViewBuilder
    private var dashboardContent: some View {
        if let snap = store.snapshot {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    headerRow
                    healthSection(snap)
                    schedulerSection(snap)
                    engineSection(snap)
                    memorySection(snap)
                }
                .padding(PopeyeUI.contentPadding)
            }
        }
    }

    private var headerRow: some View {
        HStack {
            Text("System Overview")
                .font(.title2.bold())
            Spacer()
            FreshnessPill(lastUpdated: store.lastUpdated)
            if let lastUpdated = store.lastUpdated {
                Text("Updated \(DateFormatting.formatRelativeTime(lastUpdated))")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private func healthSection(_ snap: DashboardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Daemon Health")
                .font(.headline)
                .foregroundStyle(.secondary)
            LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
                HealthCard(status: snap.status)
                UptimeCard(status: snap.status)
                RunningJobsCard(status: snap.status)
                OpenInterventionsCard(status: snap.status)
            }
        }
    }

    private func schedulerSection(_ snap: DashboardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Scheduler & Cost")
                .font(.headline)
                .foregroundStyle(.secondary)
            LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
                SchedulerCard(scheduler: snap.scheduler)
                ActiveLeasesCard(scheduler: snap.scheduler)
                TotalRunsCard(usage: snap.usage)
                EstimatedCostCard(usage: snap.usage)
            }
        }
    }

    private func engineSection(_ snap: DashboardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Engine Capabilities")
                .font(.headline)
                .foregroundStyle(.secondary)
            LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
                HostToolsCard(capabilities: snap.capabilities)
                SessionsCard(capabilities: snap.capabilities)
                CompactionCard(capabilities: snap.capabilities)
                if let audit = snap.securityAudit {
                    SecurityCard(audit: audit)
                }
            }
        }
    }

    @ViewBuilder
    private func memorySection(_ snap: DashboardSnapshot) -> some View {
        if let audit = snap.memoryAudit {
            VStack(alignment: .leading, spacing: 8) {
                Text("Memory")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
                    MemoryAuditCard(audit: audit)
                }
            }
        }
    }

    private func reload() {
        Task {
            await store.load()
            store.startPolling()
        }
    }
}
