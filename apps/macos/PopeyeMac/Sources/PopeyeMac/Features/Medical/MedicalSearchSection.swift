import SwiftUI
import PopeyeAPI

struct MedicalSearchSection: View {
    @Binding var searchText: String
    let searchResults: [MedicalSearchResultDTO]
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
                loadingTitle: "Searching medical records…",
                failureTitle: "Couldn’t search medical records",
                retryAction: search
            )

            if trimmedSearchText.isEmpty {
                Text("Search imported medical records in the current workspace.")
                    .foregroundStyle(.secondary)
            } else if searchResults.isEmpty, phase.error == nil, phase.isLoading == false {
                Text("No medical matches found.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(searchResults) { result in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(result.recordType.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.headline)
                        Text(result.redactedSummary)
                            .foregroundStyle(.secondary)
                        Text(result.date.map(DateFormatting.formatAbsoluteTime) ?? "No date")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var searchField: some View {
        TextField("Search medical records", text: $searchText)
            .textFieldStyle(.roundedBorder)
            .help("Search imported medical records in the current workspace")
            .onSubmit(search)
    }

    private var trimmedSearchText: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var searchButton: some View {
        Button("Search", action: search)
            .buttonStyle(.borderedProminent)
            .help("Search imported medical records. Press Return in the field to submit.")
    }
}
