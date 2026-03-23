import SwiftUI
import PopeyeAPI

struct DashboardView: View {
    var store: DashboardStore
    @State private var debouncer = ReloadDebouncer()

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 16), count: 4)

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
        .task {
            await store.load()
            store.startPolling()
        }
        .onDisappear {
            store.stopPolling()
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.refresh() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal,
               [.runs, .jobs, .security, .general].contains(signal) {
                debouncer.schedule { [store] in await store.refresh() }
            }
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
                }
                .padding(20)
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
            LazyVGrid(columns: columns, spacing: 16) {
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
            LazyVGrid(columns: columns, spacing: 16) {
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
            LazyVGrid(columns: columns, spacing: 16) {
                HostToolsCard(capabilities: snap.capabilities)
                SessionsCard(capabilities: snap.capabilities)
                CompactionCard(capabilities: snap.capabilities)
                if let audit = snap.securityAudit {
                    SecurityCard(audit: audit)
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
