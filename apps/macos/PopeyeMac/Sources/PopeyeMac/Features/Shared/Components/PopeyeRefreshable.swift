import SwiftUI
import PopeyeAPI

private struct PopeyeRefreshableModifier: ViewModifier {
    let invalidationSignals: [InvalidationSignal]
    let reload: @MainActor () async -> Void

    @State private var debouncer = ReloadDebouncer()

    func body(content: Content) -> some View {
        content
            .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
                Task {
                    await reload()
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
                guard let signal = notification.object as? InvalidationSignal,
                      invalidationSignals.contains(signal)
                else { return }

                debouncer.schedule {
                    await reload()
                }
            }
    }
}

extension View {
    func popeyeRefreshable(
        invalidationSignals: [InvalidationSignal],
        reload: @escaping @MainActor () async -> Void
    ) -> some View {
        modifier(PopeyeRefreshableModifier(invalidationSignals: invalidationSignals, reload: reload))
    }
}
