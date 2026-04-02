import Foundation
import PopeyeAPI

@Observable @MainActor
final class FilesStore {
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            roots = []
            selectedRootID = nil
            selectedRoot = nil
            searchResults = []
            selectedDocumentID = nil
            selectedDocument = nil
            writeIntents = []
            searchText = ""
            error = nil
            mutationMessage = nil
            mutationErrorMessage = nil
            lastIndexResult = nil
        }
    }

    var roots: [FileRootDTO] = []
    var selectedRootID: String?
    var selectedRoot: FileRootDTO?
    var searchText = ""
    var searchResults: [FileSearchResultDTO] = []
    var selectedDocumentID: String?
    var selectedDocument: FileDocumentDTO?
    var writeIntents: [FileWriteIntentDTO] = []
    var isLoading = false
    var error: APIError?
    var isMutating = false
    var mutationMessage: String?
    var mutationErrorMessage: String?
    var lastIndexResult: FileIndexResultDTO?

    private let service: FilesService

    init(client: ControlAPIClient) {
        self.service = FilesService(client: client)
    }

    func load() async {
        isLoading = true
        error = nil
        do {
            roots = try await service.loadRoots(workspaceId: workspaceID)
            if selectedRootID == nil || roots.contains(where: { $0.id == selectedRootID }) == false {
                selectedRootID = roots.first?.id
            }
            if let selectedRootID {
                await loadRoot(id: selectedRootID)
            }
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
        isLoading = false
    }

    func loadRoot(id: String) async {
        do {
            async let root = service.loadRoot(id: id)
            async let intents = service.loadWriteIntents(rootId: id)
            selectedRoot = try await root
            writeIntents = (try? await intents) ?? []
            if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                searchResults = []
                selectedDocumentID = nil
                selectedDocument = nil
            } else {
                await search()
            }
        } catch {
            PopeyeLogger.refresh.error("Files root load failed: \(error)")
        }
    }

    func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.isEmpty == false else {
            searchResults = []
            selectedDocumentID = nil
            selectedDocument = nil
            return
        }

        do {
            let response = try await service.search(query: query, rootId: selectedRootID, workspaceId: workspaceID, limit: 20)
            searchResults = response.results
            if let selectedDocumentID,
               searchResults.contains(where: { $0.documentId == selectedDocumentID }) {
                await loadDocument(id: selectedDocumentID)
            } else if let first = searchResults.first {
                selectedDocumentID = first.documentId
                await loadDocument(id: first.documentId)
            } else {
                selectedDocumentID = nil
                selectedDocument = nil
            }
        } catch {
            PopeyeLogger.refresh.error("Files search failed: \(error)")
        }
    }

    func loadDocument(id: String) async {
        do {
            selectedDocument = try await service.loadDocument(id: id)
        } catch {
            PopeyeLogger.refresh.error("Files document load failed: \(error)")
        }
    }

    func createRoot(input: FileRootRegistrationInput) async {
        beginMutation()
        do {
            let root = try await service.createRoot(input: input)
            selectedRootID = root.id
            await load()
            mutationMessage = "Added file root \(root.label)."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func updateRoot(id: String, input: FileRootUpdateInput) async {
        beginMutation()
        do {
            let root = try await service.updateRoot(id: id, input: input)
            selectedRootID = root.id
            await load()
            mutationMessage = "Updated file root \(root.label)."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func deleteSelectedRoot() async {
        guard let selectedRootID else { return }
        beginMutation()
        do {
            try await service.deleteRoot(id: selectedRootID)
            await load()
            mutationMessage = "Removed the selected file root."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func reindexSelectedRoot() async {
        guard let selectedRootID else { return }
        beginMutation()
        do {
            lastIndexResult = try await service.reindexRoot(id: selectedRootID)
            await load()
            mutationMessage = "Reindexed the selected file root."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func reviewWriteIntent(id: String, action: String, reason: String? = nil) async {
        beginMutation()
        do {
            let reviewed = try await service.reviewWriteIntent(id: id, action: action, reason: reason)
            if let index = writeIntents.firstIndex(where: { $0.id == reviewed.id }) {
                writeIntents[index] = reviewed
            }
            mutationMessage = action == "apply"
                ? "Applied the selected write intent."
                : "Rejected the selected write intent."
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
