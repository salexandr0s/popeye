import Foundation
import PopeyeAPI

@Observable @MainActor
final class BrainStore {
    var identities: [IdentityRecordDTO] = []
    var defaultIdentity: WorkspaceIdentityDefaultDTO?
    var preview: InstructionPreviewDTO?
    var selectedPane: BrainPane? = .overview
    var isLoading = false
    var error: APIError?

    private let systemService: SystemService
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            identities = []
            defaultIdentity = nil
            preview = nil
        }
    }

    init(client: ControlAPIClient) {
        self.systemService = SystemService(client: client)
    }

    var snapshot: BrainSnapshot {
        BrainSnapshot(
            identities: identities,
            defaultIdentity: defaultIdentity,
            preview: preview
        )
    }

    func load() async {
        isLoading = true
        error = nil

        do {
            async let loadedIdentities = systemService.loadIdentities(workspaceId: workspaceID)
            async let loadedPreview = systemService.loadInstructionPreview(scope: workspaceID)
            async let loadedDefaultIdentity = systemService.loadDefaultIdentity(workspaceId: workspaceID)

            identities = try await loadedIdentities
            preview = try await loadedPreview
            defaultIdentity = try? await loadedDefaultIdentity
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }

        isLoading = false
    }
}
