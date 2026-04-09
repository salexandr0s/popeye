import SwiftUI
import PopeyeAPI

struct EmailView: View {
    @Bindable var store: EmailStore
    @Environment(AppModel.self) private var appModel

    var body: some View {
        rootContent
            .navigationTitle("Mail")
            .toolbar {
                ToolbarItemGroup {
                    TextField("Search mail", text: $store.searchQuery)
                        .textFieldStyle(.roundedBorder)
                        .frame(minWidth: 220)
                        .disabled(store.activeAccount == nil || store.mutationState == .executing || store.isSearching)
                        .onSubmit {
                            Task { await store.performSearch() }
                        }

                    Button("Search", systemImage: "magnifyingglass") {
                        Task { await store.performSearch() }
                    }
                    .disabled(!store.canSearch)

                    Toggle("Unread Only", isOn: $store.isUnreadOnly)
                        .toggleStyle(.button)
                        .disabled(!store.canToggleUnreadOnly)

                    if store.isSearchMode {
                        Button("Clear Search", systemImage: "xmark.circle") {
                            Task { await store.clearSearch() }
                        }
                        .disabled(!store.canClearSearch)
                    }

                    Button("Sync", systemImage: "arrow.clockwise") {
                        Task { await store.syncSelectedAccount() }
                    }
                    .disabled(!store.canSyncSelectedAccount)

                    Button("Generate Digest", systemImage: "sparkles.rectangle.stack") {
                        Task { await store.generateDigest() }
                    }
                    .disabled(!store.canGenerateDigest)

                    Button("New Draft", systemImage: "square.and.pencil") {
                        store.beginCreateDraft()
                    }
                    .disabled(!store.canCreateDraft)

                    Button("Refresh", systemImage: "arrow.triangle.2.circlepath") {
                        Task { await store.load() }
                    }
                }
            }
            .task(id: appModel.selectedWorkspaceID) {
                store.workspaceID = appModel.selectedWorkspaceID
                await store.load()
            }
            .onChange(of: store.selectedThreadID) { _, newValue in
                Task { await store.handleSelectedThreadChange(newValue) }
            }
            .onChange(of: store.selectedAccountID) { oldValue, newValue in
                Task { await store.handleSelectedAccountChange(oldValue: oldValue, newValue: newValue) }
            }
            .onChange(of: store.isUnreadOnly) { _, _ in
                Task { await store.didChangeUnreadOnly() }
            }
            .popeyeRefreshable(invalidationSignals: [.connections, .general]) {
                await store.load()
            }
            .overlay(alignment: .bottomTrailing) {
                MutationStateOverlay(state: store.mutationState, dismiss: store.dismissMutation)
                    .padding(20)
            }
            .sheet(isPresented: emailDraftSheetIsPresented) {
                EmailDraftSheet(store: store)
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
                    threads: store.threads,
                    searchResults: store.searchResults,
                    activeSearchQuery: store.activeSearchQuery,
                    searchError: store.searchError,
                    isSearching: store.isSearching
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
                EmailAccountOperationsSection(
                    syncResult: store.visibleSyncResult,
                    digest: store.digest
                )

                EmailDraftSection(
                    drafts: store.visibleDrafts,
                    isLoadingDetail: store.isLoadingDraftDetail,
                    detailError: store.draftDetailError,
                    canEditDrafts: store.canBeginDraftEdit,
                    editDraft: { draft in
                        Task { await store.beginEditDraft(draft) }
                    }
                )

                if store.isSearchMode, let query = store.activeSearchQuery {
                    InspectorSection(title: "Search Results") {
                        Label("Results for \"\(query)\"", systemImage: "magnifyingglass")
                            .font(.subheadline.weight(.semibold))
                        Text("\(store.visibleSearchResultCount) result\(store.visibleSearchResultCount == 1 ? "" : "s") in the selected mailbox.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let searchError = store.searchError {
                            Text(searchError.userMessage)
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                    }
                }

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

    private var emailDraftSheetIsPresented: Binding<Bool> {
        Binding(
            get: { store.editor != nil },
            set: { isPresented in
                if !isPresented {
                    store.cancelDraftEditor()
                }
            }
        )
    }
}
