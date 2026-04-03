import SwiftUI
import PopeyeAPI

@MainActor
private struct FinancePreviewContainer: View {
    let store: FinanceStore

    var body: some View {
        NavigationStack {
            FinanceView(store: store)
        }
        .frame(width: 1180, height: 760)
    }
}

extension FinanceStore {
    @MainActor
    static func previewLoading() -> FinanceStore {
        let store = FinanceStore(dependencies: .init(
            loadVaults: { try await FeaturePreviewFixtures.suspended() },
            loadImports: { try await FeaturePreviewFixtures.suspended() },
            loadDigest: { _ in try await FeaturePreviewFixtures.suspended() },
            loadTransactions: { _, _ in try await FeaturePreviewFixtures.suspended() },
            loadDocuments: { _ in try await FeaturePreviewFixtures.suspended() },
            search: { _, _ in try await FeaturePreviewFixtures.suspended() },
            triggerDigest: { _ in try await FeaturePreviewFixtures.suspended() },
            createImport: { _, _, _ in try await FeaturePreviewFixtures.suspended() },
            createTransaction: { _ in try await FeaturePreviewFixtures.suspended() },
            updateImportStatus: { _, _, _ in try await FeaturePreviewFixtures.suspended() },
            openVault: { _ in try await FeaturePreviewFixtures.suspended() },
            closeVault: { _ in try await FeaturePreviewFixtures.suspended() }
        ))
        store.loadPhase = .loading
        return store
    }

    @MainActor
    static func previewEmpty() -> FinanceStore {
        let vault = FeaturePreviewFixtures.financeVault
        let digest = FeaturePreviewFixtures.financeDigest
        let importRecord = FeaturePreviewFixtures.financeImports[0]
        let transaction = FeaturePreviewFixtures.financeTransactions[0]
        let emptySearch = FeaturePreviewFixtures.financeSearchResponse(query: "", results: [])

        return FinanceStore(dependencies: .init(
            loadVaults: { [vault] },
            loadImports: { [] },
            loadDigest: { _ in nil },
            loadTransactions: { _, _ in [] },
            loadDocuments: { _ in [] },
            search: { _, _ in emptySearch },
            triggerDigest: { _ in digest },
            createImport: { _, _, _ in importRecord },
            createTransaction: { _ in transaction },
            updateImportStatus: { _, _, _ in },
            openVault: { _ in vault },
            closeVault: { _ in vault }
        ))
    }

    @MainActor
    static func previewFailed() -> FinanceStore {
        let digest = FeaturePreviewFixtures.financeDigest
        let importRecord = FeaturePreviewFixtures.financeImports[0]
        let transaction = FeaturePreviewFixtures.financeTransactions[0]
        let vault = FeaturePreviewFixtures.financeVault
        let emptySearch = FeaturePreviewFixtures.financeSearchResponse(query: "", results: [])

        return FinanceStore(dependencies: .init(
            loadVaults: { throw APIError.transportUnavailable },
            loadImports: { [] },
            loadDigest: { _ in nil },
            loadTransactions: { _, _ in [] },
            loadDocuments: { _ in [] },
            search: { _, _ in emptySearch },
            triggerDigest: { _ in digest },
            createImport: { _, _, _ in importRecord },
            createTransaction: { _ in transaction },
            updateImportStatus: { _, _, _ in },
            openVault: { _ in vault },
            closeVault: { _ in vault }
        ))
    }

    @MainActor
    static func previewPopulated() -> FinanceStore {
        let vault = FeaturePreviewFixtures.financeVault
        let imports = FeaturePreviewFixtures.financeImports
        let digest = FeaturePreviewFixtures.financeDigest
        let transactions = FeaturePreviewFixtures.financeTransactions
        let documents = FeaturePreviewFixtures.financeDocuments
        let searchResults = FeaturePreviewFixtures.financeSearchResults
        let searchResponse = FeaturePreviewFixtures.financeSearchResponse(query: "grocery", results: searchResults)

        let store = FinanceStore(dependencies: .init(
            loadVaults: { [vault] },
            loadImports: { imports },
            loadDigest: { _ in digest },
            loadTransactions: { _, _ in transactions },
            loadDocuments: { _ in documents },
            search: { _, _ in searchResponse },
            triggerDigest: { _ in digest },
            createImport: { _, _, _ in imports[0] },
            createTransaction: { _ in transactions[0] },
            updateImportStatus: { _, _, _ in },
            openVault: { _ in vault },
            closeVault: { _ in vault }
        ))
        store.searchText = "grocery"
        store.selectedImportID = imports[0].id
        return store
    }

    @MainActor
    static func previewMutationSuccess() -> FinanceStore {
        let store = previewPopulated()
        store.mutations.state = .succeeded("Regenerated the finance digest.")
        return store
    }

    @MainActor
    static func previewMutationFailure() -> FinanceStore {
        let store = previewPopulated()
        store.mutations.state = .failed("Couldn’t regenerate the finance digest.")
        return store
    }
}

#Preview("Finance / Loading") {
    FinancePreviewContainer(store: .previewLoading())
}

#Preview("Finance / Empty") {
    FinancePreviewContainer(store: .previewEmpty())
}

#Preview("Finance / Error") {
    FinancePreviewContainer(store: .previewFailed())
}

#Preview("Finance / Populated") {
    FinancePreviewContainer(store: .previewPopulated())
}

#Preview("Finance / Mutation Success") {
    FinancePreviewContainer(store: .previewMutationSuccess())
}

#Preview("Finance / Mutation Failure") {
    FinancePreviewContainer(store: .previewMutationFailure())
}
