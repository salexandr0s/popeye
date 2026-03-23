import SwiftUI
import PopeyeAPI

struct SchedulerView: View {
    @Bindable var jobsStore: JobsStore
    @Bindable var dashboardStore: DashboardStore
    @State private var debouncer = ReloadDebouncer()

    private static let activeStates: Set<String> = [
        "queued", "leased", "running", "waiting_retry", "paused", "blocked_operator",
    ]
    private static let terminalStates: Set<String> = [
        "succeeded", "failed_final", "cancelled",
    ]

    var body: some View {
        Group {
            if jobsStore.isLoading && jobsStore.jobs.isEmpty {
                LoadingStateView(title: "Loading scheduler…")
            } else {
                schedulerContent
            }
        }
        .navigationTitle("Scheduler")
        .task {
            async let _ = jobsStore.load()
            async let _ = dashboardStore.load()
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task {
                await jobsStore.load()
                await dashboardStore.load()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.jobs, .general].contains(signal) {
                debouncer.schedule { [jobsStore, dashboardStore] in
                    await jobsStore.load()
                    await dashboardStore.load()
                }
            }
        }
    }

    private var schedulerContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let scheduler = dashboardStore.snapshot?.scheduler {
                    SchedulerStatusHeader(scheduler: scheduler)
                }

                inFlightSection
                recentCompletionsSection
            }
            .padding()
        }
    }

    private var inFlightJobs: [JobRecordDTO] {
        jobsStore.jobs
            .filter { Self.activeStates.contains($0.status) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    private var recentCompletions: [JobRecordDTO] {
        jobsStore.jobs
            .filter { Self.terminalStates.contains($0.status) }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(10)
            .map { $0 }
    }

    private var inFlightSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("In-Flight Jobs")
                .font(.headline)

            if inFlightJobs.isEmpty {
                Text("No active jobs")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
            } else {
                jobTable(jobs: inFlightJobs)
            }
        }
    }

    private var recentCompletionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Recent Completions")
                .font(.headline)

            if recentCompletions.isEmpty {
                Text("No completed jobs yet")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
            } else {
                jobTable(jobs: recentCompletions)
            }
        }
    }

    private func jobTable(jobs: [JobRecordDTO]) -> some View {
        VStack(spacing: 0) {
            // Header
            HStack(spacing: 0) {
                headerCell("Status", fixedWidth: 120)
                headerCell("Task")
                headerCell("Retries", fixedWidth: 70)
                headerCell("Updated", fixedWidth: 140)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.background.secondary)

            Divider()

            // Rows
            ForEach(jobs) { job in
                HStack(spacing: 0) {
                    StatusBadge(state: job.status)
                        .frame(width: 120, alignment: .leading)
                    Text(IdentifierFormatting.formatShortID(job.taskId))
                        .font(.callout.monospaced())
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(job.retryCount)")
                        .font(.callout.monospacedDigit())
                        .frame(width: 70, alignment: .trailing)
                    Text(DateFormatting.formatRelativeTime(job.updatedAt))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .frame(width: 140, alignment: .trailing)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)

                Divider()
            }
        }
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(.separator, lineWidth: 0.5)
        )
    }

    private func headerCell(_ title: String, fixedWidth: CGFloat? = nil) -> some View {
        Group {
            if let w = fixedWidth {
                Text(title)
                    .frame(width: w, alignment: .leading)
            } else {
                Text(title)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .font(.caption)
        .fontWeight(.medium)
        .foregroundStyle(.secondary)
    }
}
