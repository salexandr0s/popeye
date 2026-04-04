import SwiftUI
import PopeyeAPI

struct EmailView: View {
    @Bindable var store: EmailStore
    @Environment(AppModel.self) private var appModel

    var body: some View {
        rootContent
        .navigationTitle("Mail")
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onChange(of: store.selectedThreadID) { _, newValue in
            guard let newValue else { return }
            Task { await store.loadThread(id: newValue) }
        }
        .onChange(of: store.selectedAccountID) { oldValue, newValue in
            guard oldValue != newValue, oldValue != nil else { return }
            Task { await store.load() }
        }
        .popeyeRefreshable(invalidationSignals: [.connections, .general]) {
            await store.load()
        }
    }

    @ViewBuilder
    private var rootContent: some View {
        if store.isLoading && store.accounts.isEmpty {
            LoadingStateView(title: "Loading email…")
        } else if let error = store.error, store.accounts.isEmpty {
            ErrorStateView(error: error, retryAction: reload)
        } else {
            HSplitView {
                EmailSidebar(
                    selectedAccountID: $store.selectedAccountID,
                    selectedThreadID: $store.selectedThreadID,
                    accounts: store.accounts,
                    activeAccount: store.activeAccount,
                    threads: store.threads
                )
                .popeyeSplitPane(minWidth: 300, idealWidth: 340, maxWidth: 380)

                detail
                    .popeyeSplitPane(minWidth: 520)
            }
        }
    }

    private var detail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                if let digest = store.digest {
                    EmailDigestSection(digest: digest)
                }

                if let thread = store.selectedThread {
                    EmailThreadDetailSection(thread: thread)
                } else {
                    ContentUnavailableView("Select a thread", systemImage: "envelope.open")
                        .frame(maxWidth: .infinity, minHeight: 320)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
