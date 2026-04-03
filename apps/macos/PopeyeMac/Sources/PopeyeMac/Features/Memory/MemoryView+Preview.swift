import SwiftUI
import PopeyeAPI

@MainActor
private struct MemoryPreviewContainer: View {
    let store: MemoryStore
    private let appModel = FeaturePreviewFixtures.previewAppModel()

    var body: some View {
        NavigationStack {
            MemoryView(store: store)
        }
        .environment(appModel)
        .frame(width: 1180, height: 760)
    }
}

extension MemoryStore {
    @MainActor
    static func previewLoading() -> MemoryStore {
        let store = MemoryStore(dependencies: .init(
            listMemories: { _, _ in try await FeaturePreviewFixtures.suspended() },
            searchMemories: { _, _, _ in try await FeaturePreviewFixtures.suspended() },
            loadMemoryDetail: { _ in try await FeaturePreviewFixtures.suspended() },
            loadMemoryHistory: { _ in try await FeaturePreviewFixtures.suspended() },
            pinMemory: { _, _, _ in try await FeaturePreviewFixtures.suspended() },
            forgetMemory: { _, _ in try await FeaturePreviewFixtures.suspended() },
            proposePromotion: { _, _ in try await FeaturePreviewFixtures.suspended() },
            executePromotion: { _, _ in try await FeaturePreviewFixtures.suspended() }
        ))
        store.loadPhase = .loading
        store.viewMode = .browse
        return store
    }

    @MainActor
    static func previewEmpty() -> MemoryStore {
        let store = MemoryStore(dependencies: .init(
            listMemories: { _, _ in [] },
            searchMemories: { _, query, _ in FeaturePreviewFixtures.memorySearchResponse(query: query, results: []) },
            loadMemoryDetail: { _ in FeaturePreviewFixtures.memoryRecord },
            loadMemoryHistory: { _ in FeaturePreviewFixtures.memoryHistory },
            pinMemory: { _, _, _ in },
            forgetMemory: { _, _ in },
            proposePromotion: { _, _ in FeaturePreviewFixtures.memoryPromotionProposal },
            executePromotion: { _, _ in }
        ))
        store.loadPhase = .empty
        store.viewMode = .browse
        return store
    }

    @MainActor
    static func previewFailed() -> MemoryStore {
        let store = MemoryStore(dependencies: .init(
            listMemories: { _, _ in throw APIError.transportUnavailable },
            searchMemories: { _, query, _ in FeaturePreviewFixtures.memorySearchResponse(query: query, results: []) },
            loadMemoryDetail: { _ in FeaturePreviewFixtures.memoryRecord },
            loadMemoryHistory: { _ in FeaturePreviewFixtures.memoryHistory },
            pinMemory: { _, _, _ in },
            forgetMemory: { _, _ in },
            proposePromotion: { _, _ in FeaturePreviewFixtures.memoryPromotionProposal },
            executePromotion: { _, _ in }
        ))
        store.loadPhase = .failed(.transportUnavailable)
        store.viewMode = .browse
        return store
    }

    @MainActor
    static func previewPopulated() -> MemoryStore {
        let records = FeaturePreviewFixtures.memoryRecords
        let store = MemoryStore(dependencies: .init(
            listMemories: { _, _ in records },
            searchMemories: { _, query, _ in FeaturePreviewFixtures.memorySearchResponse(query: query, results: FeaturePreviewFixtures.memorySearchHits) },
            loadMemoryDetail: { _ in FeaturePreviewFixtures.memoryRecord },
            loadMemoryHistory: { _ in FeaturePreviewFixtures.memoryHistory },
            pinMemory: { _, _, _ in },
            forgetMemory: { _, _ in },
            proposePromotion: { _, _ in FeaturePreviewFixtures.memoryPromotionProposal },
            executePromotion: { _, _ in }
        ))
        store.memories = records
        store.selectedMemoryId = records[0].id
        store.selectedDetail = FeaturePreviewFixtures.memoryRecord
        store.memoryHistory = FeaturePreviewFixtures.memoryHistory
        store.ensureSelectedDay()
        store.loadPhase = .loaded
        store.viewMode = .daily
        return store
    }

    @MainActor
    static func previewSearchFailure() -> MemoryStore {
        let store = previewPopulated()
        store.viewMode = .search
        store.searchText = "daily review"
        store.searchResults = FeaturePreviewFixtures.memorySearchResponse(query: store.searchText, results: FeaturePreviewFixtures.memorySearchHits)
        store.searchPhase = .failed(.transportUnavailable)
        return store
    }

    @MainActor
    static func previewMutationSuccess() -> MemoryStore {
        let store = previewPopulated()
        store.mutations.state = .succeeded("Memory pinned")
        return store
    }

    @MainActor
    static func previewMutationFailure() -> MemoryStore {
        let store = previewPopulated()
        store.mutations.state = .failed("Couldn’t pin this memory.")
        return store
    }
}

#Preview("Memory / Loading") {
    MemoryPreviewContainer(store: .previewLoading())
}

#Preview("Memory / Empty") {
    MemoryPreviewContainer(store: .previewEmpty())
}

#Preview("Memory / Error") {
    MemoryPreviewContainer(store: .previewFailed())
}

#Preview("Memory / Populated") {
    MemoryPreviewContainer(store: .previewPopulated())
}

#Preview("Memory / Search Failure") {
    MemoryPreviewContainer(store: .previewSearchFailure())
}

#Preview("Memory / Mutation Success") {
    MemoryPreviewContainer(store: .previewMutationSuccess())
}

#Preview("Memory / Mutation Failure") {
    MemoryPreviewContainer(store: .previewMutationFailure())
}
