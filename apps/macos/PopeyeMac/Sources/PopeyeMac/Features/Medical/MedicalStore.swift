import Foundation
import PopeyeAPI

@Observable @MainActor
final class MedicalStore {
    struct Dependencies: Sendable {
        let loadVaults: @Sendable () async throws -> [VaultRecordDTO]
        let loadImports: @Sendable () async throws -> [MedicalImportDTO]
        let loadDigest: @Sendable (_ period: String?) async throws -> MedicalDigestDTO?
        let loadAppointments: @Sendable (_ importID: String?, _ limit: Int?) async throws -> [MedicalAppointmentDTO]
        let loadMedications: @Sendable (_ importID: String?) async throws -> [MedicalMedicationDTO]
        let loadDocuments: @Sendable (_ importID: String?) async throws -> [MedicalDocumentDTO]
        let search: @Sendable (_ query: String, _ limit: Int) async throws -> MedicalSearchResponseDTO
        let triggerDigest: @Sendable (_ period: String?) async throws -> MedicalDigestDTO
        let createImport: @Sendable (_ vaultID: String, _ importType: String, _ fileName: String) async throws -> MedicalImportDTO
        let createAppointment: @Sendable (_ input: MedicalAppointmentCreateInput) async throws -> MedicalAppointmentDTO
        let createMedication: @Sendable (_ input: MedicalMedicationCreateInput) async throws -> MedicalMedicationDTO
        let createDocument: @Sendable (_ input: MedicalDocumentCreateInput) async throws -> MedicalDocumentDTO
        let updateImportStatus: @Sendable (_ id: String, _ status: String) async throws -> Void
        let openVault: @Sendable (_ id: String) async throws -> VaultRecordDTO
        let closeVault: @Sendable (_ id: String) async throws -> VaultRecordDTO

        static func live(client: ControlAPIClient) -> Self {
            let service = MedicalService(client: client)
            return Self(
                loadVaults: { try await service.loadVaults() },
                loadImports: { try await service.loadImports() },
                loadDigest: { period in try await service.loadDigest(period: period) },
                loadAppointments: { importID, limit in try await service.loadAppointments(importId: importID, limit: limit) },
                loadMedications: { importID in try await service.loadMedications(importId: importID) },
                loadDocuments: { importID in try await service.loadDocuments(importId: importID) },
                search: { query, limit in try await service.search(query: query, limit: limit) },
                triggerDigest: { period in try await service.triggerDigest(period: period) },
                createImport: { vaultID, importType, fileName in
                    try await service.createImport(vaultId: vaultID, importType: importType, fileName: fileName)
                },
                createAppointment: { input in try await service.createAppointment(input: input) },
                createMedication: { input in try await service.createMedication(input: input) },
                createDocument: { input in try await service.createDocument(input: input) },
                updateImportStatus: { id, status in try await service.updateImportStatus(id: id, status: status) },
                openVault: { id in try await service.openVault(id: id) },
                closeVault: { id in try await service.closeVault(id: id) }
            )
        }
    }

    var vaults: [VaultRecordDTO] = []
    var imports: [MedicalImportDTO] = []
    var appointments: [MedicalAppointmentDTO] = []
    var medications: [MedicalMedicationDTO] = []
    var documents: [MedicalDocumentDTO] = []
    var digest: MedicalDigestDTO?
    var searchText = ""
    var searchResults: [MedicalSearchResultDTO] = []
    var selectedImportID: String?
    var loadPhase: ScreenLoadPhase = .idle
    var selectionPhase: ScreenOperationPhase = .idle
    var searchPhase: ScreenOperationPhase = .idle

    let mutations = MutationExecutor()

    private let dependencies: Dependencies

    init(client: ControlAPIClient) {
        self.dependencies = .live(client: client)
    }

    init(dependencies: Dependencies) {
        self.dependencies = dependencies
    }

    var isLoading: Bool { loadPhase.isLoading }
    var error: APIError? { loadPhase.error }
    var isMutating: Bool { mutationState == .executing }
    var mutationState: MutationState { mutations.state }
    var selectionError: APIError? { selectionPhase.error }
    var searchError: APIError? { searchPhase.error }

    var activeImport: MedicalImportDTO? {
        imports.first { $0.id == selectedImportID } ?? imports.first
    }

    var primaryVault: VaultRecordDTO? {
        vaults.first
    }

    func load() async {
        loadPhase = .loading
        selectionPhase = .idle
        searchPhase = .idle

        do {
            async let loadedVaults = dependencies.loadVaults()
            async let loadedImports = dependencies.loadImports()
            async let loadedDigest = dependencies.loadDigest("quarter")
            vaults = try await loadedVaults
            imports = try await loadedImports
            digest = try await loadedDigest

            if selectedImportID == nil || imports.contains(where: { $0.id == selectedImportID }) == false {
                selectedImportID = imports.first?.id
            }

            if selectedImportID == nil {
                appointments = []
                medications = []
                documents = []
                searchResults = []
                selectionPhase = .idle
                searchPhase = .idle
            } else {
                await reloadSelection()
            }

            loadPhase = imports.isEmpty ? .empty : .loaded
        } catch {
            loadPhase = .failed(map(error))
        }
    }

    func reloadSelection() async {
        guard selectedImportID != nil else {
            appointments = []
            medications = []
            documents = []
            selectionPhase = .idle
            return
        }

        selectionPhase = .loading

        do {
            async let loadedAppointments = dependencies.loadAppointments(selectedImportID, 20)
            async let loadedMedications = dependencies.loadMedications(selectedImportID)
            async let loadedDocuments = dependencies.loadDocuments(selectedImportID)
            appointments = try await loadedAppointments
            medications = try await loadedMedications
            documents = try await loadedDocuments
            selectionPhase = .idle
            if trimmedSearchText.isEmpty == false {
                await search()
            }
        } catch {
            selectionPhase = .failed(map(error))
        }
    }

    func search() async {
        let query = trimmedSearchText
        guard query.isEmpty == false else {
            searchResults = []
            searchPhase = .idle
            return
        }

        searchPhase = .loading

        do {
            searchResults = try await dependencies.search(query, 20).results
            searchPhase = .idle
        } catch {
            searchPhase = .failed(map(error))
        }
    }

    func triggerDigest() async {
        await mutations.execute(
            action: {
                self.digest = try await self.dependencies.triggerDigest("quarter")
            },
            successMessage: "Regenerated the medical digest.",
            fallbackError: "Medical digest failed"
        )
    }

    func createImport(vaultId: String, importType: String, fileName: String) async {
        await mutations.execute(
            action: {
                let created = try await self.dependencies.createImport(vaultId, importType, fileName)
                self.selectedImportID = created.id
            },
            successMessage: "Created medical import \(fileName).",
            fallbackError: "Create medical import failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func createAppointment(input: MedicalAppointmentCreateInput) async {
        await mutations.execute(
            action: {
                _ = try await self.dependencies.createAppointment(input)
            },
            successMessage: "Added a medical appointment.",
            fallbackError: "Add appointment failed",
            reload: { [weak self] in await self?.reloadSelection() }
        )
    }

    func createMedication(input: MedicalMedicationCreateInput) async {
        await mutations.execute(
            action: {
                _ = try await self.dependencies.createMedication(input)
            },
            successMessage: "Added a medication record.",
            fallbackError: "Add medication failed",
            reload: { [weak self] in await self?.reloadSelection() }
        )
    }

    func createDocument(input: MedicalDocumentCreateInput) async {
        await mutations.execute(
            action: {
                _ = try await self.dependencies.createDocument(input)
            },
            successMessage: "Added a medical document.",
            fallbackError: "Add document failed",
            reload: { [weak self] in await self?.reloadSelection() }
        )
    }

    func updateImportStatus(_ status: String) async {
        guard let activeImport else { return }
        await mutations.execute(
            action: {
                try await self.dependencies.updateImportStatus(activeImport.id, status)
            },
            successMessage: "Updated import status to \(status).",
            fallbackError: "Update import status failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func openVault() async {
        guard let primaryVault else { return }
        await mutations.execute(
            action: {
                _ = try await self.dependencies.openVault(primaryVault.id)
            },
            successMessage: "Opened the medical vault for operator actions.",
            fallbackError: "Open vault failed",
            reload: { [weak self] in await self?.refreshVaults() }
        )
    }

    func closeVault() async {
        guard let primaryVault else { return }
        await mutations.execute(
            action: {
                _ = try await self.dependencies.closeVault(primaryVault.id)
            },
            successMessage: "Closed the medical vault.",
            fallbackError: "Close vault failed",
            reload: { [weak self] in await self?.refreshVaults() }
        )
    }

    func dismissMutation() {
        mutations.dismiss()
    }

    private var trimmedSearchText: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func refreshVaults() async {
        do {
            vaults = try await dependencies.loadVaults()
        } catch {
            PopeyeLogger.refresh.error("Medical vault refresh failed: \(error)")
        }
    }

    private func map(_ error: Error) -> APIError {
        (error as? APIError) ?? .transportUnavailable
    }
}
