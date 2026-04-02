import SwiftUI
import PopeyeAPI

struct EmailView: View {
    @Bindable var store: EmailStore
    @Environment(AppModel.self) private var appModel
    @State private var debouncer = ReloadDebouncer()

    var body: some View {
        Group {
            if store.isLoading && store.accounts.isEmpty {
                LoadingStateView(title: "Loading email…")
            } else if let error = store.error, store.accounts.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                HSplitView {
                    sidebar
                        .frame(minWidth: 300, idealWidth: 340, maxWidth: 380)
                    detail
                        .frame(minWidth: 520)
                }
            }
        }
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
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.connections, .general].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Account", selection: $store.selectedAccountID) {
                    ForEach(store.accounts) { account in
                        Text(account.displayName).tag(Optional(account.id))
                    }
                }
                .pickerStyle(.menu)

                if let account = store.activeAccount {
                    Text(account.emailAddress)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(16)

            Divider()

            if store.threads.isEmpty {
                EmptyStateView(icon: "envelope", title: "No threads yet", description: "Connect Gmail in Setup to start browsing mail.")
            } else {
                List(store.threads, selection: $store.selectedThreadID) { thread in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(thread.subject.isEmpty ? "(No subject)" : thread.subject)
                                .font(.headline)
                                .lineLimit(1)
                            Spacer()
                            if thread.isUnread {
                                Image(systemName: "circle.fill")
                                    .font(.system(size: 8))
                                    .foregroundStyle(.blue)
                            }
                        }
                        Text(thread.snippet)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Text(DateFormatting.formatRelativeTime(thread.lastMessageAt))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                    .tag(thread.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private var detail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let digest = store.digest {
                    InspectorSection(title: "Digest") {
                        DetailRow(label: "Unread", value: "\(digest.unreadCount)")
                        DetailRow(label: "High signal", value: "\(digest.highSignalCount)")
                        Text(digest.summaryMarkdown)
                            .foregroundStyle(.secondary)
                    }
                }

                if let thread = store.selectedThread {
                    InspectorSection(title: thread.subject.isEmpty ? "Thread" : thread.subject) {
                        DetailRow(label: "Messages", value: "\(thread.messageCount)")
                        DetailRow(label: "Importance", value: thread.importance.capitalized)
                        DetailRow(label: "Last updated", value: DateFormatting.formatAbsoluteTime(thread.lastMessageAt))
                        Text(thread.snippet)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    ContentUnavailableView("Select a thread", systemImage: "envelope.open")
                        .frame(maxWidth: .infinity, minHeight: 320)
                }
            }
            .padding(20)
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
