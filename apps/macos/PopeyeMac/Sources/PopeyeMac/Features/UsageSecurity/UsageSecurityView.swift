import SwiftUI
import PopeyeAPI

struct UsageSecurityView: View {
    var store: UsageSecurityStore

    var body: some View {
        Group {
            if store.isLoading && store.usage == nil && store.controlChanges.isEmpty {
                LoadingStateView(title: "Loading usage & security...")
            } else {
                usageSecurityContent
            }
        }
        .navigationTitle("Usage & Security")
        .task {
            await store.load()
        }
        .popeyeRefreshable(invalidationSignals: [.security, .telegram, .general]) {
            await store.load()
        }
    }

    private var usageSecurityContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                UsageSection(usage: store.usage)
                SecuritySection(audit: store.securityAudit)
                ControlChangesSection(receipts: store.controlChanges)
            }
            .padding(PopeyeUI.contentPadding)
        }
    }
}
