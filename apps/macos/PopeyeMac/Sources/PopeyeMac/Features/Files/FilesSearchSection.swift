import SwiftUI
import PopeyeAPI

struct FilesSearchSection: View {
    @Binding var searchText: String
    let searchResults: [FileSearchResultDTO]
    let search: () -> Void
    let selectDocument: (FileSearchResultDTO) -> Void

    var body: some View {
        InspectorSection(title: "Search") {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    searchField
                    searchButton
                }

                VStack(alignment: .leading, spacing: 8) {
                    searchField
                    searchButton
                }
            }

            if trimmedSearchText.isEmpty {
                Text("Search within the selected file root to inspect indexed documents.")
                    .foregroundStyle(.secondary)
            } else if searchResults.isEmpty {
                Text("No matching documents found.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(searchResults) { result in
                    Button {
                        selectDocument(result)
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
                        .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(result.relativePath)
                    .accessibilityValue(result.snippet)
                    .contextMenu {
                        Button("Inspect Document", systemImage: "doc.text.magnifyingglass") {
                            selectDocument(result)
                        }
                    }
                }
            }
        }
    }

    private var trimmedSearchText: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var searchField: some View {
        TextField("Search documents", text: $searchText)
            .textFieldStyle(.roundedBorder)
            .help("Enter a document name or content snippet from the selected file root")
            .onSubmit(search)
    }

    private var searchButton: some View {
        Button("Search", action: search)
            .buttonStyle(.borderedProminent)
            .help("Search indexed documents in the selected file root. Press Return in the field to submit.")
    }
}
