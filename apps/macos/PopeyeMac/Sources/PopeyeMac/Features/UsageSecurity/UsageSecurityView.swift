import SwiftUI
import PopeyeAPI

struct UsageSecurityView: View {
    var store: UsageSecurityStore
    @State private var debouncer = ReloadDebouncer()

    var body: some View {
        Group {
            if store.isLoading && store.usage == nil {
                LoadingStateView(title: "Loading usage & security...")
            } else {
                usageSecurityContent
            }
        }
        .navigationTitle("Usage & Security")
        .task {
            await store.load()
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.security, .general].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var usageSecurityContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                UsageSection(usage: store.usage)
                SecuritySection(audit: store.securityAudit)
            }
            .padding(20)
        }
    }
}
