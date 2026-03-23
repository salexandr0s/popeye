import SwiftUI
import PopeyeAPI

struct MemorySearchResultsView: View {
    @Bindable var store: MemoryStore

    var body: some View {
        Group {
            if store.isSearching {
                LoadingStateView(title: "Searching...")
            } else if let results = store.searchResults {
                if results.results.isEmpty {
                    EmptyStateView(
                        icon: "magnifyingglass",
                        title: "No results",
                        description: "No memories matched \"\(results.query)\"."
                    )
                } else {
                    resultsList(results)
                }
            } else {
                EmptyStateView(
                    icon: "brain",
                    title: "Search memories",
                    description: "Enter a query to search the memory system."
                )
            }
        }
    }

    private func resultsList(_ response: MemorySearchResponseDTO) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("\(response.totalCandidates) candidates, \(response.results.count) results")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(response.latencyMs, format: .number.precision(.fractionLength(0)))ms")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)

            List(response.results, selection: $store.selectedMemoryId) { hit in
                MemorySearchHitRow(hit: hit)
            }
            .listStyle(.inset)
        }
    }
}

struct MemorySearchHitRow: View {
    let hit: MemorySearchHitDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(hit.description)
                .font(.body)
                .lineLimit(2)

            HStack(spacing: 8) {
                StatusBadge(state: hit.type)
                if let layer = hit.layer {
                    StatusBadge(state: layer)
                }
                Text(hit.effectiveConfidence, format: .percent.precision(.fractionLength(0)))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(DateFormatting.formatRelativeTime(hit.createdAt))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }

}
