import SwiftUI
import PopeyeAPI

struct MemorySearchResultsView: View {
    @Bindable var store: MemoryStore

    var body: some View {
        VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
            if store.searchPhase != .idle {
                OperationStatusView(
                    phase: store.searchPhase,
                    loadingTitle: "Searching memories…",
                    failureTitle: "Search failed",
                    retryAction: { Task { await store.search() } }
                )
                .padding(.horizontal, PopeyeUI.contentPadding)
                .padding(.top, PopeyeUI.contentPadding)
            }

            Group {
                if let results = store.searchResults {
                    if results.results.isEmpty {
                        EmptyStateView(
                            icon: "magnifyingglass",
                            title: "No results",
                            description: "No memories matched \"\(results.query)\"."
                        )
                    } else {
                        resultsList(results)
                    }
                } else if store.searchPhase == .loading {
                    Spacer(minLength: 0)
                } else {
                    EmptyStateView(
                        icon: "brain",
                        title: "Search memories",
                        description: "Enter a query to search the memory system."
                    )
                }
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
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Search summary")
            .accessibilityValue(searchSummary(response))

            List(response.results, selection: $store.selectedMemoryId) { hit in
                MemorySearchHitRow(hit: hit, isSelected: store.selectedMemoryId == hit.id)
            }
            .listStyle(.inset)
        }
    }

    private func searchSummary(_ response: MemorySearchResponseDTO) -> String {
        [
            "\(response.totalCandidates) candidates",
            "\(response.results.count) results",
            "\(response.latencyMs.formatted(.number.precision(.fractionLength(0)))) milliseconds"
        ].joined(separator: ", ")
    }
}

struct MemorySearchHitRow: View {
    let hit: MemorySearchHitDTO
    var isSelected = false

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
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(hit.description)
        .accessibilityValue(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        var parts = [
            hit.type.replacing("_", with: " ").capitalized,
            "Confidence \(hit.effectiveConfidence.formatted(.percent.precision(.fractionLength(0))))",
            "Created \(DateFormatting.formatRelativeTime(hit.createdAt))"
        ]

        if let layer = hit.layer {
            parts.append(layer.replacing("_", with: " ").capitalized)
        }

        if let domain = hit.domain, !domain.isEmpty {
            parts.append(domain.capitalized)
        }

        if let content = hit.content, !content.isEmpty {
            parts.append(content)
        }

        if isSelected {
            parts.append("Selected")
        }

        return parts.joined(separator: ", ")
    }
}
