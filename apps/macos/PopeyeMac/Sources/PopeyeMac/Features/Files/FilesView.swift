import SwiftUI
import PopeyeAPI

struct FilesView: View {
    @Bindable var store: FilesStore
    @Environment(AppModel.self) private var appModel
    @State private var debouncer = ReloadDebouncer()
    @State private var isPresentingCreateRoot = false
    @State private var editingRoot: FileRootDTO?
    @State private var showDeleteConfirmation = false

    var body: some View {
        Group {
            if store.isLoading && store.roots.isEmpty {
                LoadingStateView(title: "Loading files…")
            } else if let error = store.error, store.roots.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                HSplitView {
                    sidebar
                        .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)
                    detail
                        .frame(minWidth: 560)
                }
            }
        }
        .navigationTitle("Files")
        .toolbar {
            ToolbarItemGroup {
                Button("Add Root", systemImage: "plus") {
                    isPresentingCreateRoot = true
                }
                Button("Refresh", systemImage: "arrow.clockwise") {
                    reload()
                }
            }
        }
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onChange(of: store.selectedRootID) { _, newValue in
            guard let newValue else { return }
            Task { await store.loadRoot(id: newValue) }
        }
        .onChange(of: store.selectedDocumentID) { _, newValue in
            guard let newValue else { return }
            Task { await store.loadDocument(id: newValue) }
        }
        .onChange(of: store.searchText) { _, newValue in
            if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Task { await store.search() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.general, .memory].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
        .sheet(isPresented: $isPresentingCreateRoot) {
            FileRootEditorSheet(
                workspaceID: appModel.selectedWorkspaceID,
                existingRoot: nil,
                onCreate: { input in
                    Task { await store.createRoot(input: input) }
                },
                onUpdate: { _, _ in }
            )
        }
        .sheet(item: $editingRoot) { root in
            FileRootEditorSheet(
                workspaceID: appModel.selectedWorkspaceID,
                existingRoot: root,
                onCreate: { _ in },
                onUpdate: { id, input in
                    Task { await store.updateRoot(id: id, input: input) }
                }
            )
        }
        .alert("Remove this file root?", isPresented: $showDeleteConfirmation) {
            Button("Remove", role: .destructive) {
                Task { await store.deleteSelectedRoot() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The root configuration will be removed from the workspace. Indexed documents and write-intent visibility will disappear after refresh.")
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Text(appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID)
                    .font(.headline)
                Text("Workspace file roots and write intent visibility")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(16)

            Divider()

            if store.roots.isEmpty {
                EmptyStateView(icon: "folder", title: "No file roots", description: "Configured file roots will appear here once the workspace is indexed.")
            } else {
                List(store.roots, selection: $store.selectedRootID) { root in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(root.label)
                                .font(.headline)
                            Spacer()
                            StatusBadge(state: root.enabled ? "enabled" : "disabled")
                        }
                        Text(root.rootPath)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Text(root.lastIndexedAt.map(DateFormatting.formatRelativeTime) ?? "Never indexed")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                    .tag(root.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private var detail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                mutationBanner

                if let root = store.selectedRoot {
                    InspectorSection(title: "Root") {
                        DetailRow(label: "Path", value: root.rootPath)
                        DetailRow(label: "Permission", value: root.permission.capitalized)
                        DetailRow(label: "Patterns", value: root.filePatterns.isEmpty ? "All files" : root.filePatterns.joined(separator: ", "))
                        DetailRow(label: "Indexed", value: root.lastIndexedAt.map(DateFormatting.formatAbsoluteTime) ?? "Not yet")
                        HStack(spacing: 8) {
                            Button("Edit Root") {
                                editingRoot = root
                            }
                            .buttonStyle(.bordered)

                            Button("Reindex") {
                                Task { await store.reindexSelectedRoot() }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(store.isMutating)

                            Button("Delete Root", role: .destructive) {
                                showDeleteConfirmation = true
                            }
                            .buttonStyle(.bordered)
                            .disabled(store.isMutating)
                        }

                        if let result = store.lastIndexResult {
                            Divider()
                            DetailRow(label: "Indexed", value: "\(result.indexed)")
                            DetailRow(label: "Updated", value: "\(result.updated)")
                            DetailRow(label: "Skipped", value: "\(result.skipped)")
                            if result.errors.isEmpty == false {
                                Text(result.errors.joined(separator: "\n"))
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                }

                InspectorSection(title: "Search") {
                    HStack(spacing: 8) {
                        TextField("Search documents", text: $store.searchText)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { Task { await store.search() } }
                        Button("Search") {
                            Task { await store.search() }
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    if store.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("Search within the selected file root to inspect indexed documents.")
                            .foregroundStyle(.secondary)
                    } else if store.searchResults.isEmpty {
                        Text("No matching documents found.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.searchResults) { result in
                            Button {
                                store.selectedDocumentID = result.documentId
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(result.relativePath)
                                        .font(.headline)
                                    Text(result.snippet)
                                        .font(.callout)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(3)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(.background.secondary)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                InspectorSection(title: "Selected Document") {
                    if let document = store.selectedDocument {
                        DetailRow(label: "Relative Path", value: document.relativePath)
                        DetailRow(label: "Hash", value: document.contentHash)
                        DetailRow(label: "Size", value: ByteCountFormatter.string(fromByteCount: Int64(document.sizeBytes), countStyle: .file))
                        DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(document.updatedAt))
                        if let memoryId = document.memoryId {
                            Button("Open Related Memory") {
                                appModel.navigateToMemory(id: memoryId)
                            }
                            .buttonStyle(.link)
                        }
                    } else {
                        Text("Select a search result to inspect document metadata.")
                            .foregroundStyle(.secondary)
                    }
                }

                InspectorSection(title: "Recent Write Intents") {
                    if store.writeIntents.isEmpty {
                        Text("No pending or recent write intents for this root.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.writeIntents.prefix(8)) { intent in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(intent.filePath)
                                        .font(.headline)
                                    Spacer()
                                    StatusBadge(state: intent.status)
                                }
                                Text(intent.intentType.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                                Text(intent.diffPreview)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                                    .lineLimit(6)
                                Text(DateFormatting.formatRelativeTime(intent.createdAt))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                if intent.status == "pending" {
                                    HStack(spacing: 8) {
                                        Button("Apply") {
                                            Task { await store.reviewWriteIntent(id: intent.id, action: "apply") }
                                        }
                                        .buttonStyle(.borderedProminent)
                                        .disabled(store.isMutating)

                                        Button("Reject", role: .destructive) {
                                            Task { await store.reviewWriteIntent(id: intent.id, action: "reject") }
                                        }
                                        .buttonStyle(.bordered)
                                        .disabled(store.isMutating)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
    }

    private func reload() {
        Task { await store.load() }
    }

    @ViewBuilder
    private var mutationBanner: some View {
        if let message = store.mutationMessage {
            Label(message, systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        } else if let message = store.mutationErrorMessage {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        }
    }
}
