import SwiftUI
import PopeyeAPI

struct SchedulerView: View {
    @Bindable var jobsStore: JobsStore
    @Bindable var dashboardStore: DashboardStore

    var body: some View {
        Group {
            if jobsStore.isLoading && jobsStore.jobs.isEmpty {
                LoadingStateView(title: "Loading scheduler…")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                        if let scheduler = dashboardStore.snapshot?.scheduler {
                            SchedulerStatusHeader(scheduler: scheduler)
                        }

                        SchedulerJobsSection(
                            title: "In-Flight Jobs",
                            emptyMessage: "No active jobs",
                            jobs: SchedulerJobBuckets.inFlightJobs(from: jobsStore.jobs)
                        )

                        SchedulerJobsSection(
                            title: "Recent Completions",
                            emptyMessage: "No completed jobs yet",
                            jobs: SchedulerJobBuckets.recentCompletions(from: jobsStore.jobs)
                        )
                    }
                    .padding(PopeyeUI.contentPadding)
                }
            }
        }
        .navigationTitle("Scheduler")
        .task {
            await loadAll()
        }
        .popeyeRefreshable(invalidationSignals: [.jobs, .general]) {
            await loadAll()
        }
    }

    private func loadAll() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await jobsStore.load() }
            group.addTask { await dashboardStore.load() }
        }
    }
}
