import Foundation
import PopeyeAPI

@Observable @MainActor
final class MedicalStore {
    var vaults: [VaultRecordDTO] = []
    var imports: [MedicalImportDTO] = []
    var appointments: [MedicalAppointmentDTO] = []
    var medications: [MedicalMedicationDTO] = []
    var documents: [MedicalDocumentDTO] = []
    var digest: MedicalDigestDTO?
    var searchText = ""
    var searchResults: [MedicalSearchResultDTO] = []
    var selectedImportID: String?
    var isLoading = false
    var error: APIError?
    var isMutating = false
    var mutationMessage: String?
    var mutationErrorMessage: String?

    private let service: MedicalService

    init(client: ControlAPIClient) {
        self.service = MedicalService(client: client)
    }

    var activeImport: MedicalImportDTO? {
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
            async let loadedDigest = service.loadDigest(period: "quarter")
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
            async let loadedAppointments = service.loadAppointments(importId: selectedImportID, limit: 20)
            async let loadedMedications = service.loadMedications(importId: selectedImportID)
            async let loadedDocuments = service.loadDocuments(importId: selectedImportID)
            appointments = try await loadedAppointments
            medications = try await loadedMedications
            documents = try await loadedDocuments
            if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                await search()
            }
        } catch {
            PopeyeLogger.refresh.error("Medical selection load failed: \(error)")
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
            PopeyeLogger.refresh.error("Medical search failed: \(error)")
        }
    }

    func triggerDigest() async {
        beginMutation()
        do {
            digest = try await service.triggerDigest(period: "quarter")
            mutationMessage = "Regenerated the medical digest."
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
            mutationMessage = "Created medical import \(created.fileName)."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func createAppointment(input: MedicalAppointmentCreateInput) async {
        beginMutation()
        do {
            _ = try await service.createAppointment(input: input)
            await reloadSelection()
            mutationMessage = "Added a medical appointment."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func createMedication(input: MedicalMedicationCreateInput) async {
        beginMutation()
        do {
            _ = try await service.createMedication(input: input)
            await reloadSelection()
            mutationMessage = "Added a medication record."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func createDocument(input: MedicalDocumentCreateInput) async {
        beginMutation()
        do {
            _ = try await service.createDocument(input: input)
            await reloadSelection()
            mutationMessage = "Added a medical document."
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
            try await service.updateImportStatus(id: activeImport.id, status: status)
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
            mutationMessage = "Opened the medical vault for operator actions."
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
            mutationMessage = "Closed the medical vault."
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
