import SwiftUI
import PopeyeAPI

struct FinanceSearchSection: View {
    @Binding var searchText: String
    let searchResults: [FinanceSearchResultDTO]
    let phase: ScreenOperationPhase
    let search: () -> Void

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

            OperationStatusView(
                phase: phase,
                loadingTitle: "Searching finance records…",
                failureTitle: "Couldn’t search finance records",
                retryAction: search
            )

            if trimmedSearchText.isEmpty {
                Text("Search imported finance records in the current workspace.")
                    .foregroundStyle(.secondary)
            } else if searchResults.isEmpty, phase.error == nil, phase.isLoading == false {
                Text("No finance matches found.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(searchResults) { result in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(result.description)
                            .font(.headline)
                        Text(result.redactedSummary)
                            .foregroundStyle(.secondary)
                        Text(result.amount.formatted(.currency(code: "USD")))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var searchField: some View {
        TextField("Search finance", text: $searchText)
            .textFieldStyle(.roundedBorder)
            .help("Search imported finance records in the current workspace")
            .onSubmit(search)
    }

    private var trimmedSearchText: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var searchButton: some View {
        Button("Search", action: search)
            .buttonStyle(.borderedProminent)
            .help("Search imported finance records. Press Return in the field to submit.")
    }
}
