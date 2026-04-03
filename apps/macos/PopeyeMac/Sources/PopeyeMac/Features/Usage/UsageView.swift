import SwiftUI
import Charts
import PopeyeAPI

struct UsageView: View {
    var store: UsageStore

    var body: some View {
        Group {
            switch store.loadingState {
            case .idle, .loading:
                LoadingStateView(title: "Loading usage analytics...")
            case .loaded:
                usageContent
            case .failed(let error):
                ErrorStateView(error: error, retryAction: reload)
            }
        }
        .navigationTitle("Usage")
        .task {
            await store.load()
        }
        .popeyeRefreshable(invalidationSignals: [.receipts, .runs, .general]) {
            await store.refresh()
        }
    }

    private var usageContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                headerRow
                UsageSummaryCards(store: store)
                UsageCostChart(dailyCosts: store.costByDay)
                HStack(alignment: .top, spacing: 16) {
                    UsageModelBreakdown(models: store.costByModel)
                    UsageStatusBreakdown(statuses: store.costByStatus)
                }
                UsageTopRunsTable(runs: store.topExpensiveRuns)
            }
            .padding(PopeyeUI.contentPadding)
        }
    }

    private var headerRow: some View {
        HStack {
            Text("Usage Analytics")
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

    private func reload() {
        Task { await store.load() }
    }
}
