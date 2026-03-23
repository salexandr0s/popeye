import Foundation
import PopeyeAPI

@Observable @MainActor
final class InstructionPreviewStore {
    var scopeInput = ""
    var preview: InstructionPreviewDTO?
    var isLoading = false
    var error: String?

    private let systemService: SystemService

    init(client: ControlAPIClient) {
        self.systemService = SystemService(client: client)
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
}
