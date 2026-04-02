import Foundation
import PopeyeAPI

@Observable @MainActor
final class FinanceStore {
    var vaults: [VaultRecordDTO] = []
    var imports: [FinanceImportDTO] = []
    var transactions: [FinanceTransactionDTO] = []
    var documents: [FinanceDocumentDTO] = []
    var digest: FinanceDigestDTO?
    var searchText = ""
    var searchResults: [FinanceSearchResultDTO] = []
    var selectedImportID: String?
    var isLoading = false
    var error: APIError?
    var isMutating = false
    var mutationMessage: String?
    var mutationErrorMessage: String?

    private let service: FinanceService

    init(client: ControlAPIClient) {
        self.service = FinanceService(client: client)
    }

    var activeImport: FinanceImportDTO? {
        imports.first { $0.id == selectedImportID } ?? imports.first
    }

    var primaryVault: VaultRecordDTO? {
        vaults.first
    }

    func load() async {
        isLoading = true
        error = nil
        do {
            async let loadedVaults = service.loadVaults()
            async let loadedImports = service.loadImports()
            async let loadedDigest = service.loadDigest(period: "month")
            vaults = (try? await loadedVaults) ?? []
            imports = try await loadedImports
            digest = try? await loadedDigest
            if selectedImportID == nil || imports.contains(where: { $0.id == selectedImportID }) == false {
                selectedImportID = imports.first?.id
            }
            await reloadSelection()
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
        isLoading = false
    }

    func reloadSelection() async {
        do {
            async let loadedTransactions = service.loadTransactions(importId: selectedImportID, limit: 50)
            async let loadedDocuments = service.loadDocuments(importId: selectedImportID)
            transactions = try await loadedTransactions
            documents = try await loadedDocuments
            if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                await search()
            }
        } catch {
            PopeyeLogger.refresh.error("Finance selection load failed: \(error)")
        }
    }

    func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.isEmpty == false else {
            searchResults = []
            return
        }
        do {
            searchResults = try await service.search(query: query, limit: 20).results
        } catch {
            PopeyeLogger.refresh.error("Finance search failed: \(error)")
        }
    }

    func triggerDigest() async {
        beginMutation()
        do {
            digest = try await service.triggerDigest(period: "month")
            mutationMessage = "Regenerated the finance digest."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func createImport(vaultId: String, importType: String, fileName: String) async {
        beginMutation()
        do {
            let created = try await service.createImport(vaultId: vaultId, importType: importType, fileName: fileName)
            selectedImportID = created.id
            await load()
            mutationMessage = "Created finance import \(created.fileName)."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func createTransaction(input: FinanceTransactionCreateInput) async {
        beginMutation()
        do {
            _ = try await service.createTransaction(input: input)
            await reloadSelection()
            mutationMessage = "Created a finance transaction."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func updateImportStatus(_ status: String) async {
        guard let activeImport else { return }
        beginMutation()
        do {
            try await service.updateImportStatus(id: activeImport.id, status: status, recordCount: transactions.count)
            await load()
            mutationMessage = "Updated import status to \(status)."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func openVault() async {
        guard let primaryVault else { return }
        beginMutation()
        do {
            _ = try await service.openVault(id: primaryVault.id)
            vaults = (try? await service.loadVaults()) ?? vaults
            mutationMessage = "Opened the finance vault for operator actions."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func closeVault() async {
        guard let primaryVault else { return }
        beginMutation()
        do {
            _ = try await service.closeVault(id: primaryVault.id)
            vaults = (try? await service.loadVaults()) ?? vaults
            mutationMessage = "Closed the finance vault."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    private func beginMutation() {
        isMutating = true
        mutationMessage = nil
        mutationErrorMessage = nil
    }
}
