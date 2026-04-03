import SwiftUI
import PopeyeAPI

@MainActor
private struct MedicalPreviewContainer: View {
    let store: MedicalStore

    var body: some View {
        NavigationStack {
            MedicalView(store: store)
        }
        .frame(width: 1180, height: 760)
    }
}

extension MedicalStore {
    @MainActor
    static func previewLoading() -> MedicalStore {
        let store = MedicalStore(dependencies: .init(
            loadVaults: { try await FeaturePreviewFixtures.suspended() },
            loadImports: { try await FeaturePreviewFixtures.suspended() },
            loadDigest: { _ in try await FeaturePreviewFixtures.suspended() },
            loadAppointments: { _, _ in try await FeaturePreviewFixtures.suspended() },
            loadMedications: { _ in try await FeaturePreviewFixtures.suspended() },
            loadDocuments: { _ in try await FeaturePreviewFixtures.suspended() },
            search: { _, _ in try await FeaturePreviewFixtures.suspended() },
            triggerDigest: { _ in try await FeaturePreviewFixtures.suspended() },
            createImport: { _, _, _ in try await FeaturePreviewFixtures.suspended() },
            createAppointment: { _ in try await FeaturePreviewFixtures.suspended() },
            createMedication: { _ in try await FeaturePreviewFixtures.suspended() },
            createDocument: { _ in try await FeaturePreviewFixtures.suspended() },
            updateImportStatus: { _, _ in try await FeaturePreviewFixtures.suspended() },
            openVault: { _ in try await FeaturePreviewFixtures.suspended() },
            closeVault: { _ in try await FeaturePreviewFixtures.suspended() }
        ))
        store.loadPhase = .loading
        return store
    }

    @MainActor
    static func previewEmpty() -> MedicalStore {
        let vault = FeaturePreviewFixtures.medicalVault
        let digest = FeaturePreviewFixtures.medicalDigest
        let importRecord = FeaturePreviewFixtures.medicalImports[0]
        let appointment = FeaturePreviewFixtures.medicalAppointments[0]
        let medication = FeaturePreviewFixtures.medicalMedications[0]
        let document = FeaturePreviewFixtures.medicalDocuments[0]
        let emptySearch = FeaturePreviewFixtures.medicalSearchResponse(query: "", results: [])

        return MedicalStore(dependencies: .init(
            loadVaults: { [vault] },
            loadImports: { [] },
            loadDigest: { _ in nil },
            loadAppointments: { _, _ in [] },
            loadMedications: { _ in [] },
            loadDocuments: { _ in [] },
            search: { _, _ in emptySearch },
            triggerDigest: { _ in digest },
            createImport: { _, _, _ in importRecord },
            createAppointment: { _ in appointment },
            createMedication: { _ in medication },
            createDocument: { _ in document },
            updateImportStatus: { _, _ in },
            openVault: { _ in vault },
            closeVault: { _ in vault }
        ))
    }

    @MainActor
    static func previewFailed() -> MedicalStore {
        let digest = FeaturePreviewFixtures.medicalDigest
        let importRecord = FeaturePreviewFixtures.medicalImports[0]
        let appointment = FeaturePreviewFixtures.medicalAppointments[0]
        let medication = FeaturePreviewFixtures.medicalMedications[0]
        let document = FeaturePreviewFixtures.medicalDocuments[0]
        let vault = FeaturePreviewFixtures.medicalVault
        let emptySearch = FeaturePreviewFixtures.medicalSearchResponse(query: "", results: [])

        return MedicalStore(dependencies: .init(
            loadVaults: { throw APIError.transportUnavailable },
            loadImports: { [] },
            loadDigest: { _ in nil },
            loadAppointments: { _, _ in [] },
            loadMedications: { _ in [] },
            loadDocuments: { _ in [] },
            search: { _, _ in emptySearch },
            triggerDigest: { _ in digest },
            createImport: { _, _, _ in importRecord },
            createAppointment: { _ in appointment },
            createMedication: { _ in medication },
            createDocument: { _ in document },
            updateImportStatus: { _, _ in },
            openVault: { _ in vault },
            closeVault: { _ in vault }
        ))
    }

    @MainActor
    static func previewPopulated() -> MedicalStore {
        let vault = FeaturePreviewFixtures.medicalVault
        let imports = FeaturePreviewFixtures.medicalImports
        let digest = FeaturePreviewFixtures.medicalDigest
        let appointments = FeaturePreviewFixtures.medicalAppointments
        let medications = FeaturePreviewFixtures.medicalMedications
        let documents = FeaturePreviewFixtures.medicalDocuments
        let searchResults = FeaturePreviewFixtures.medicalSearchResults
        let searchResponse = FeaturePreviewFixtures.medicalSearchResponse(query: "follow-up", results: searchResults)

        let store = MedicalStore(dependencies: .init(
            loadVaults: { [vault] },
            loadImports: { imports },
            loadDigest: { _ in digest },
            loadAppointments: { _, _ in appointments },
            loadMedications: { _ in medications },
            loadDocuments: { _ in documents },
            search: { _, _ in searchResponse },
            triggerDigest: { _ in digest },
            createImport: { _, _, _ in imports[0] },
            createAppointment: { _ in appointments[0] },
            createMedication: { _ in medications[0] },
            createDocument: { _ in documents[0] },
            updateImportStatus: { _, _ in },
            openVault: { _ in vault },
            closeVault: { _ in vault }
        ))
        store.searchText = "follow-up"
        store.selectedImportID = imports[0].id
        return store
    }

    @MainActor
    static func previewMutationSuccess() -> MedicalStore {
        let store = previewPopulated()
        store.mutations.state = .succeeded("Added a medical appointment.")
        return store
    }

    @MainActor
    static func previewMutationFailure() -> MedicalStore {
        let store = previewPopulated()
        store.mutations.state = .failed("Couldn’t add a medical appointment.")
        return store
    }
}

#Preview("Medical / Loading") {
    MedicalPreviewContainer(store: .previewLoading())
}

#Preview("Medical / Empty") {
    MedicalPreviewContainer(store: .previewEmpty())
}

#Preview("Medical / Error") {
    MedicalPreviewContainer(store: .previewFailed())
}

#Preview("Medical / Populated") {
    MedicalPreviewContainer(store: .previewPopulated())
}

#Preview("Medical / Mutation Success") {
    MedicalPreviewContainer(store: .previewMutationSuccess())
}

#Preview("Medical / Mutation Failure") {
    MedicalPreviewContainer(store: .previewMutationFailure())
}
