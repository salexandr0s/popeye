import Foundation

@MainActor
final class ReloadDebouncer {
    private var pendingTask: Task<Void, Never>?
    private let delay: Duration

    init(delay: Duration = .milliseconds(300)) {
        self.delay = delay
    }

    func schedule(_ action: @escaping @MainActor () async -> Void) {
        pendingTask?.cancel()
        pendingTask = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await action()
        }
    }
}
