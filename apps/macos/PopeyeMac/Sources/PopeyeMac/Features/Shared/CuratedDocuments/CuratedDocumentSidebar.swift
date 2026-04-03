import SwiftUI
import PopeyeAPI

struct CuratedDocumentSidebar: View {
    @Bindable var store: CuratedDocumentsStore
    let emptyTitle: String
    let emptyDescription: String

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(emptyTitle)
                        .font(.headline)
                    Text("\(store.documents.count) document\(store.documents.count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Reload Documents", systemImage: "arrow.clockwise") {
                    Task {
                        await store.load()
                    }
                }
                .buttonStyle(.plain)
                .labelStyle(.iconOnly)
                .help("Reload documents")
            }
            .padding(16)

            Divider()

            if store.documents.isEmpty {
                EmptyStateView(icon: "doc.text", title: emptyTitle, description: emptyDescription)
            } else {
                List(store.documents) { document in
                    Button {
                        store.requestSelection(document.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(document.title)
                                    .font(.headline)
                                Spacer()
                                if document.critical {
                                    StatusBadge(state: "critical")
                                }
                            }
                            Text(document.subtitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(document.filePath)
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(store.selectedDocumentID == document.id ? Color.accentColor.opacity(0.12) : .clear)
                }
                .listStyle(.sidebar)
            }
        }
    }
}
