import Foundation
import PopeyeAPI

@Observable @MainActor
final class FinanceStore {
    struct Dependencies: Sendable {
        let loadVaults: @Sendable () async throws -> [VaultRecordDTO]
        let loadImports: @Sendable () async throws -> [FinanceImportDTO]
        let loadDigest: @Sendable (_ period: String?) async throws -> FinanceDigestDTO?
        let loadTransactions: @Sendable (_ importID: String?, _ limit: Int?) async throws -> [FinanceTransactionDTO]
        let loadDocuments: @Sendable (_ importID: String?) async throws -> [FinanceDocumentDTO]
        let search: @Sendable (_ query: String, _ limit: Int) async throws -> FinanceSearchResponseDTO
        let triggerDigest: @Sendable (_ period: String?) async throws -> FinanceDigestDTO
        let createImport: @Sendable (_ vaultID: String, _ importType: String, _ fileName: String) async throws -> FinanceImportDTO
        let createTransaction: @Sendable (_ input: FinanceTransactionCreateInput) async throws -> FinanceTransactionDTO
        let updateImportStatus: @Sendable (_ id: String, _ status: String, _ recordCount: Int?) async throws -> Void
        let openVault: @Sendable (_ id: String) async throws -> VaultRecordDTO
        let closeVault: @Sendable (_ id: String) async throws -> VaultRecordDTO

        static func live(client: ControlAPIClient) -> Self {
            let service = FinanceService(client: client)
            return Self(
                loadVaults: { try await service.loadVaults() },
                loadImports: { try await service.loadImports() },
                loadDigest: { period in try await service.loadDigest(period: period) },
                loadTransactions: { importID, limit in try await service.loadTransactions(importId: importID, limit: limit) },
                loadDocuments: { importID in try await service.loadDocuments(importId: importID) },
                search: { query, limit in try await service.search(query: query, limit: limit) },
                triggerDigest: { period in try await service.triggerDigest(period: period) },
                createImport: { vaultID, importType, fileName in
                    try await service.createImport(vaultId: vaultID, importType: importType, fileName: fileName)
                },
                createTransaction: { input in try await service.createTransaction(input: input) },
                updateImportStatus: { id, status, recordCount in
                    try await service.updateImportStatus(id: id, status: status, recordCount: recordCount)
                },
                openVault: { id in try await service.openVault(id: id) },
                closeVault: { id in try await service.closeVault(id: id) }
            )
        }
    }

    var vaults: [VaultRecordDTO] = []
    var imports: [FinanceImportDTO] = []
    var transactions: [FinanceTransactionDTO] = []
    var documents: [FinanceDocumentDTO] = []
    var digest: FinanceDigestDTO?
    var searchText = ""
    var searchResults: [FinanceSearchResultDTO] = []
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

    var activeImport: FinanceImportDTO? {
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
            async let loadedDigest = dependencies.loadDigest("month")
            vaults = try await loadedVaults
            imports = try await loadedImports
            digest = try await loadedDigest

            if selectedImportID == nil || imports.contains(where: { $0.id == selectedImportID }) == false {
                selectedImportID = imports.first?.id
            }

            if selectedImportID == nil {
                transactions = []
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
            transactions = []
            documents = []
            selectionPhase = .idle
            return
        }

        selectionPhase = .loading

        do {
            async let loadedTransactions = dependencies.loadTransactions(selectedImportID, 50)
            async let loadedDocuments = dependencies.loadDocuments(selectedImportID)
            transactions = try await loadedTransactions
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
                self.digest = try await self.dependencies.triggerDigest("month")
            },
            successMessage: "Regenerated the finance digest.",
            fallbackError: "Finance digest failed"
        )
    }

    func createImport(vaultId: String, importType: String, fileName: String) async {
        await mutations.execute(
            action: {
                let created = try await self.dependencies.createImport(vaultId, importType, fileName)
                self.selectedImportID = created.id
            },
            successMessage: "Created finance import \(fileName).",
            fallbackError: "Create finance import failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func createTransaction(input: FinanceTransactionCreateInput) async {
        await mutations.execute(
            action: {
                _ = try await self.dependencies.createTransaction(input)
            },
            successMessage: "Created a finance transaction.",
            fallbackError: "Create transaction failed",
            reload: { [weak self] in await self?.reloadSelection() }
        )
    }

    func updateImportStatus(_ status: String) async {
        guard let activeImport else { return }
        await mutations.execute(
            action: {
                try await self.dependencies.updateImportStatus(activeImport.id, status, self.transactions.count)
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
            successMessage: "Opened the finance vault for operator actions.",
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
            successMessage: "Closed the finance vault.",
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
            PopeyeLogger.refresh.error("Finance vault refresh failed: \(error)")
        }
    }

    private func map(_ error: Error) -> APIError {
        (error as? APIError) ?? .transportUnavailable
    }
}
