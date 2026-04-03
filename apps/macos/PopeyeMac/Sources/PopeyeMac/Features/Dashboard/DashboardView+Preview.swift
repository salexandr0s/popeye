import SwiftUI
import PopeyeAPI

extension DashboardStore {
    @MainActor
    static func previewLoading() -> DashboardStore {
        let store = DashboardStore(
            dependencies: .init(loadSnapshot: { try await FeaturePreviewFixtures.suspended() }),
            pollIntervalSeconds: 3_600
        )
        store.loadingState = .loading
        return store
    }

    @MainActor
    static func previewFailed() -> DashboardStore {
        let store = DashboardStore(
            dependencies: .init(loadSnapshot: { throw APIError.transportUnavailable }),
            pollIntervalSeconds: 3_600
        )
        store.loadingState = .failed(.transportUnavailable)
        return store
    }

    @MainActor
    static func previewPopulated() -> DashboardStore {
        let store = DashboardStore(
            dependencies: .init(loadSnapshot: { FeaturePreviewFixtures.dashboardSnapshot }),
            pollIntervalSeconds: 3_600
        )
        store.snapshot = FeaturePreviewFixtures.dashboardSnapshot
        store.lastUpdated = .now
        store.loadingState = .loaded
        return store
    }
}

#Preview("Dashboard / Loading") {
    NavigationStack {
        DashboardView(store: .previewLoading())
    }
    .frame(width: 1180, height: 760)
}

#Preview("Dashboard / Error") {
    NavigationStack {
        DashboardView(store: .previewFailed())
    }
    .frame(width: 1180, height: 760)
}

#Preview("Dashboard / Populated") {
    NavigationStack {
        DashboardView(store: .previewPopulated())
    }
    .frame(width: 1180, height: 760)
}
