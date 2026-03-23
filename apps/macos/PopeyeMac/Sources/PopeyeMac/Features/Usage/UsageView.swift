import SwiftUI
import Charts
import PopeyeAPI

struct UsageView: View {
    var store: UsageStore
    @State private var debouncer = ReloadDebouncer()

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
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.refresh() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.receipts, .runs, .general].contains(signal) {
                debouncer.schedule { [store] in await store.refresh() }
            }
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
            .padding(20)
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
