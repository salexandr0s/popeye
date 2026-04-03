import SwiftUI
import PopeyeAPI

struct DashboardView: View {
    var store: DashboardStore

    var body: some View {
        Group {
            switch store.loadingState {
            case .idle, .loading:
                LoadingStateView(title: "Loading dashboard…")
            case .loaded:
                if let snapshot = store.snapshot {
                    DashboardContentView(
                        snapshot: snapshot,
                        lastUpdated: store.lastUpdated
                    )
                }
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

    private func reload() {
        Task {
            await store.load()
            store.startPolling()
        }
    }
}
