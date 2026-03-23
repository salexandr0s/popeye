import Foundation
import PopeyeAPI

/// Shared mutation execution with state tracking.
/// Stores hold an instance and delegate all mutations to it,
/// keeping the execute→succeed/fail→reload pattern in one place.
/// Auto-dismisses after 5 seconds as a safety net for view lifecycle gaps.
@Observable @MainActor
final class MutationExecutor {
    var state: MutationState = .idle
    private var autoDismissTask: Task<Void, Never>?

    func execute(
        action: () async throws -> Void,
        successMessage: String,
        fallbackError: String,
        reload: (() async -> Void)? = nil
    ) async {
        state = .executing
        do {
            try await action()
            state = .succeeded(successMessage)
            await reload?()
            scheduleAutoDismiss()
        } catch let error as APIError {
            state = .failed(error.userMessage)
            scheduleAutoDismiss()
        } catch {
            state = .failed(fallbackError)
            scheduleAutoDismiss()
        }
    }

    func dismiss() {
        autoDismissTask?.cancel()
        state = .idle
    }

    private func scheduleAutoDismiss() {
        autoDismissTask?.cancel()
        autoDismissTask = Task {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            state = .idle
        }
    }
}
