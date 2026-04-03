import SwiftUI
import PopeyeAPI

@MainActor
private struct HomePreviewContainer: View {
    let store: HomeStore
    private let appModel = FeaturePreviewFixtures.previewAppModel()

    var body: some View {
        NavigationStack {
            HomeView(store: store)
        }
        .environment(appModel)
        .frame(width: 1180, height: 760)
    }
}

extension HomeStore {
    @MainActor
    static func previewLoading() -> HomeStore {
        let store = HomeStore(dependencies: .init(loadSummary: { _ in try await FeaturePreviewFixtures.suspended() }))
        store.loadPhase = .loading
        return store
    }

    @MainActor
    static func previewFailed() -> HomeStore {
        let store = HomeStore(dependencies: .init(loadSummary: { _ in throw APIError.transportUnavailable }))
        store.loadPhase = .failed(.transportUnavailable)
        return store
    }

    @MainActor
    static func previewPopulated() -> HomeStore {
        let store = HomeStore(dependencies: .init(loadSummary: { _ in FeaturePreviewFixtures.homeSummary }))
        store.summary = FeaturePreviewFixtures.homeSummary
        store.loadPhase = .loaded
        return store
    }

    @MainActor
    static func previewRefreshFailure() -> HomeStore {
        let store = previewPopulated()
        store.refreshPhase = .failed(.transportUnavailable)
        return store
    }
}

#Preview("Home / Loading") {
    HomePreviewContainer(store: .previewLoading())
}

#Preview("Home / Error") {
    HomePreviewContainer(store: .previewFailed())
}

#Preview("Home / Populated") {
    HomePreviewContainer(store: .previewPopulated())
}

#Preview("Home / Refresh Failure") {
    HomePreviewContainer(store: .previewRefreshFailure())
}
