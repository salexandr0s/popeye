import Foundation
import PopeyeAPI

@Observable @MainActor
final class FilesStore {
    struct Dependencies: Sendable {
        let loadRoots: @Sendable (_ workspaceID: String) async throws -> [FileRootDTO]
        let loadRoot: @Sendable (_ id: String) async throws -> FileRootDTO
        let search: @Sendable (_ query: String, _ rootID: String?, _ workspaceID: String, _ limit: Int) async throws -> FileSearchResponseDTO
        let loadDocument: @Sendable (_ id: String) async throws -> FileDocumentDTO
        let loadWriteIntents: @Sendable (_ rootID: String?) async throws -> [FileWriteIntentDTO]
        let createRoot: @Sendable (_ input: FileRootRegistrationInput) async throws -> FileRootDTO
        let updateRoot: @Sendable (_ id: String, _ input: FileRootUpdateInput) async throws -> FileRootDTO
        let deleteRoot: @Sendable (_ id: String) async throws -> Void
        let reindexRoot: @Sendable (_ id: String) async throws -> FileIndexResultDTO
        let reviewWriteIntent: @Sendable (_ id: String, _ action: String, _ reason: String?) async throws -> FileWriteIntentDTO

        static func live(client: ControlAPIClient) -> Self {
            let service = FilesService(client: client)
            return Self(
                loadRoots: { workspaceID in
                    try await service.loadRoots(workspaceId: workspaceID)
                },
                loadRoot: { id in
                    try await service.loadRoot(id: id)
                },
                search: { query, rootID, workspaceID, limit in
                    try await service.search(query: query, rootId: rootID, workspaceId: workspaceID, limit: limit)
                },
                loadDocument: { id in
                    try await service.loadDocument(id: id)
                },
                loadWriteIntents: { rootID in
                    try await service.loadWriteIntents(rootId: rootID)
                },
                createRoot: { input in
                    try await service.createRoot(input: input)
                },
                updateRoot: { id, input in
                    try await service.updateRoot(id: id, input: input)
                },
                deleteRoot: { id in
                    try await service.deleteRoot(id: id)
                },
                reindexRoot: { id in
                    try await service.reindexRoot(id: id)
                },
                reviewWriteIntent: { id, action, reason in
                    try await service.reviewWriteIntent(id: id, action: action, reason: reason)
                }
            )
        }
    }

    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            roots = []
            selectedRootID = nil
            selectedRoot = nil
            searchText = ""
            searchResults = []
            selectedDocumentID = nil
            selectedDocument = nil
            writeIntents = []
            lastIndexResult = nil
            loadPhase = .idle
            rootPhase = .idle
            documentPhase = .idle
            searchPhase = .idle
            mutations.dismiss()
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
    var lastIndexResult: FileIndexResultDTO?
    var loadPhase: ScreenLoadPhase = .idle
    var rootPhase: ScreenOperationPhase = .idle
    var documentPhase: ScreenOperationPhase = .idle
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
    var rootSelectionError: APIError? { rootPhase.error }
    var documentError: APIError? { documentPhase.error }
    var searchError: APIError? { searchPhase.error }

    func load() async {
        loadPhase = .loading
        rootPhase = .idle
        documentPhase = .idle
        searchPhase = .idle

        do {
            roots = try await dependencies.loadRoots(workspaceID)
            if selectedRootID == nil || roots.contains(where: { $0.id == selectedRootID }) == false {
                selectedRootID = roots.first?.id
            }

            if let selectedRootID {
                await loadRoot(id: selectedRootID)
            } else {
                selectedRoot = nil
                writeIntents = []
                searchResults = []
                selectedDocumentID = nil
                selectedDocument = nil
                lastIndexResult = nil
            }

            loadPhase = roots.isEmpty ? .empty : .loaded
        } catch {
            loadPhase = .failed(map(error))
        }
    }

    func loadRoot(id: String) async {
        rootPhase = .loading
        selectedRoot = roots.first(where: { $0.id == id }) ?? selectedRoot

        do {
            async let root = dependencies.loadRoot(id)
            async let intents = dependencies.loadWriteIntents(id)
            selectedRoot = try await root
            writeIntents = try await intents
            rootPhase = .idle

            if trimmedSearchText.isEmpty {
                searchResults = []
                selectedDocumentID = nil
                selectedDocument = nil
                searchPhase = .idle
                documentPhase = .idle
            } else {
                await search()
            }
        } catch {
            rootPhase = .failed(map(error))
        }
    }

    func search() async {
        let query = trimmedSearchText
        guard query.isEmpty == false else {
            searchResults = []
            selectedDocumentID = nil
            selectedDocument = nil
            searchPhase = .idle
            documentPhase = .idle
            return
        }

        searchPhase = .loading

        do {
            let response = try await dependencies.search(query, selectedRootID, workspaceID, 20)
            searchResults = response.results
            searchPhase = .idle

            if let selectedDocumentID,
               searchResults.contains(where: { $0.documentId == selectedDocumentID }) {
                await loadDocument(id: selectedDocumentID)
            } else if let first = searchResults.first {
                selectedDocumentID = first.documentId
                await loadDocument(id: first.documentId)
            } else {
                selectedDocumentID = nil
                selectedDocument = nil
                documentPhase = .idle
            }
        } catch {
            searchPhase = .failed(map(error))
        }
    }

    func loadDocument(id: String) async {
        documentPhase = .loading

        do {
            selectedDocument = try await dependencies.loadDocument(id)
            documentPhase = .idle
        } catch {
            documentPhase = .failed(map(error))
        }
    }

    func createRoot(input: FileRootRegistrationInput) async {
        await mutations.execute(
            action: {
                let root = try await self.dependencies.createRoot(input)
                self.selectedRootID = root.id
            },
            successMessage: "Added file root \(input.label).",
            fallbackError: "Add file root failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func updateRoot(id: String, input: FileRootUpdateInput) async {
        selectedRootID = id
        await mutations.execute(
            action: {
                _ = try await self.dependencies.updateRoot(id, input)
            },
            successMessage: "Updated the selected file root.",
            fallbackError: "Update file root failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func deleteSelectedRoot() async {
        guard let selectedRootID else { return }
        await mutations.execute(
            action: {
                try await self.dependencies.deleteRoot(selectedRootID)
            },
            successMessage: "Removed the selected file root.",
            fallbackError: "Remove file root failed",
            reload: { [weak self] in await self?.load() }
        )
    }

    func reindexSelectedRoot() async {
        guard let selectedRootID else { return }
        await mutations.execute(
            action: {
                self.lastIndexResult = try await self.dependencies.reindexRoot(selectedRootID)
            },
            successMessage: "Reindexed the selected file root.",
            fallbackError: "Reindex failed",
            reload: { [weak self] in
                guard let self, let selectedRootID = self.selectedRootID else { return }
                await self.loadRoot(id: selectedRootID)
            }
        )
    }

    func reviewWriteIntent(id: String, action: String, reason: String? = nil) async {
        await mutations.execute(
            action: {
                _ = try await self.dependencies.reviewWriteIntent(id, action, reason)
            },
            successMessage: action == "apply"
                ? "Applied the selected write intent."
                : "Rejected the selected write intent.",
            fallbackError: action == "apply" ? "Apply failed" : "Reject failed",
            reload: { [weak self] in
                guard let self, let selectedRootID = self.selectedRootID else { return }
                await self.loadRoot(id: selectedRootID)
            }
        )
    }

    func dismissMutation() {
        mutations.dismiss()
    }

    private var trimmedSearchText: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func map(_ error: Error) -> APIError {
        (error as? APIError) ?? .transportUnavailable
    }
}
