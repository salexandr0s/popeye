import SwiftUI
import PopeyeAPI

@MainActor
private struct FilesPreviewContainer: View {
    let store: FilesStore
    private let appModel = FeaturePreviewFixtures.previewAppModel()

    var body: some View {
        NavigationStack {
            FilesView(store: store)
        }
        .environment(appModel)
        .frame(width: 1180, height: 760)
    }
}

extension FilesStore {
    @MainActor
    static func previewLoading() -> FilesStore {
        let store = FilesStore(dependencies: .init(
            loadRoots: { _ in try await FeaturePreviewFixtures.suspended() },
            loadRoot: { _ in try await FeaturePreviewFixtures.suspended() },
            search: { _, _, _, _ in try await FeaturePreviewFixtures.suspended() },
            loadDocument: { _ in try await FeaturePreviewFixtures.suspended() },
            loadWriteIntents: { _ in try await FeaturePreviewFixtures.suspended() },
            createRoot: { _ in try await FeaturePreviewFixtures.suspended() },
            updateRoot: { _, _ in try await FeaturePreviewFixtures.suspended() },
            deleteRoot: { _ in try await FeaturePreviewFixtures.suspended() },
            reindexRoot: { _ in try await FeaturePreviewFixtures.suspended() },
            reviewWriteIntent: { _, _, _ in try await FeaturePreviewFixtures.suspended() }
        ))
        store.loadPhase = .loading
        return store
    }

    @MainActor
    static func previewEmpty() -> FilesStore {
        let root = FeaturePreviewFixtures.fileRoot
        let document = FeaturePreviewFixtures.fileDocument
        let indexResult = FeaturePreviewFixtures.fileIndexResult
        let writeIntent = FeaturePreviewFixtures.fileWriteIntents[0]
        let emptySearch = FeaturePreviewFixtures.fileSearchResponse(query: "", results: [])

        return FilesStore(dependencies: .init(
            loadRoots: { _ in [] },
            loadRoot: { _ in root },
            search: { _, _, _, _ in emptySearch },
            loadDocument: { _ in document },
            loadWriteIntents: { _ in [] },
            createRoot: { _ in root },
            updateRoot: { _, _ in root },
            deleteRoot: { _ in },
            reindexRoot: { _ in indexResult },
            reviewWriteIntent: { _, _, _ in writeIntent }
        ))
    }

    @MainActor
    static func previewFailed() -> FilesStore {
        let root = FeaturePreviewFixtures.fileRoot
        let document = FeaturePreviewFixtures.fileDocument
        let indexResult = FeaturePreviewFixtures.fileIndexResult
        let writeIntent = FeaturePreviewFixtures.fileWriteIntents[0]
        let emptySearch = FeaturePreviewFixtures.fileSearchResponse(query: "", results: [])

        return FilesStore(dependencies: .init(
            loadRoots: { _ in throw APIError.transportUnavailable },
            loadRoot: { _ in root },
            search: { _, _, _, _ in emptySearch },
            loadDocument: { _ in document },
            loadWriteIntents: { _ in [] },
            createRoot: { _ in root },
            updateRoot: { _, _ in root },
            deleteRoot: { _ in },
            reindexRoot: { _ in indexResult },
            reviewWriteIntent: { _, _, _ in writeIntent }
        ))
    }

    @MainActor
    static func previewPopulated() -> FilesStore {
        let root = FeaturePreviewFixtures.fileRoot
        let document = FeaturePreviewFixtures.fileDocument
        let searchResults = FeaturePreviewFixtures.fileSearchResults
        let searchResponse = FeaturePreviewFixtures.fileSearchResponse(query: "memory", results: searchResults)
        let writeIntents = FeaturePreviewFixtures.fileWriteIntents
        let indexResult = FeaturePreviewFixtures.fileIndexResult

        let store = FilesStore(dependencies: .init(
            loadRoots: { _ in [root] },
            loadRoot: { _ in root },
            search: { _, _, _, _ in searchResponse },
            loadDocument: { _ in document },
            loadWriteIntents: { _ in writeIntents },
            createRoot: { _ in root },
            updateRoot: { _, _ in root },
            deleteRoot: { _ in },
            reindexRoot: { _ in indexResult },
            reviewWriteIntent: { _, _, _ in writeIntents[0] }
        ))
        store.searchText = "memory"
        store.selectedRootID = root.id
        return store
    }

    @MainActor
    static func previewMutationSuccess() -> FilesStore {
        let store = previewPopulated()
        store.mutations.state = .succeeded("Reindexed the selected file root.")
        return store
    }

    @MainActor
    static func previewMutationFailure() -> FilesStore {
        let store = previewPopulated()
        store.mutations.state = .failed("Couldn’t reindex this file root.")
        return store
    }
}

#Preview("Files / Loading") {
    FilesPreviewContainer(store: .previewLoading())
}

#Preview("Files / Empty") {
    FilesPreviewContainer(store: .previewEmpty())
}

#Preview("Files / Error") {
    FilesPreviewContainer(store: .previewFailed())
}

#Preview("Files / Populated") {
    FilesPreviewContainer(store: .previewPopulated())
}

#Preview("Files / Mutation Success") {
    FilesPreviewContainer(store: .previewMutationSuccess())
}

#Preview("Files / Mutation Failure") {
    FilesPreviewContainer(store: .previewMutationFailure())
}
