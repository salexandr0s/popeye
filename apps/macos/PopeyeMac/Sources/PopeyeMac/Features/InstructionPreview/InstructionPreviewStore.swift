import Foundation
import PopeyeAPI

@Observable @MainActor
final class InstructionPreviewStore {
    var scopeInput = "default"
    private var followedWorkspaceScope = "default"
    var preview: InstructionPreviewDTO?
    var isLoading = false
    var error: String?
    let curatedDocuments: CuratedDocumentsStore

    private let systemService: SystemService

    init(client: ControlAPIClient) {
        self.systemService = SystemService(client: client)
        self.curatedDocuments = CuratedDocumentsStore(
            client: client,
            allowedKinds: [
                "workspace_instructions",
                "project_instructions",
                "workspace_soul",
                "workspace_identity",
            ],
            preferredKinds: [
                "workspace_instructions",
                "project_instructions",
                "workspace_soul",
                "workspace_identity",
            ]
        )
    }


    func adoptWorkspaceScope(_ workspaceID: String) {
        let trimmed = scopeInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == followedWorkspaceScope {
            scopeInput = workspaceID
            if followedWorkspaceScope != workspaceID {
                preview = nil
            }
        }
        followedWorkspaceScope = workspaceID
        curatedDocuments.workspaceID = workspaceID
    }

    func loadDefaultPreviewIfNeeded() async {
        guard preview == nil, !isLoading else { return }
        await loadPreview()
    }

    func loadPreview() async {
        let scope = scopeInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !scope.isEmpty else {
            error = "Enter a scope to preview."
            return
        }

        isLoading = true
        error = nil
        do {
            preview = try await systemService.loadInstructionPreview(scope: scope)
        } catch let apiError as APIError {
            error = apiError.userMessage
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func loadCuratedDocumentsIfNeeded() async {
        await curatedDocuments.loadIfNeeded()
    }
}
