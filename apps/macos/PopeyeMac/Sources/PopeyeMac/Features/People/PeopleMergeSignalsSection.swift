import SwiftUI
import PopeyeAPI

struct PeopleMergeSignalsSection: View {
    @Bindable var store: PeopleStore

    var body: some View {
        InspectorSection(title: "Merge Signals") {
            if store.selectedSuggestions.isEmpty && store.mergeEvents.isEmpty {
                Text("No merge suggestions or merge history for this person.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(store.selectedSuggestions) { suggestion in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Possible duplicate: \(suggestion.sourceDisplayName) ↔ \(suggestion.targetDisplayName)")
                                    .font(.headline)
                                Text(suggestion.reason)
                                    .foregroundStyle(.secondary)
                                Text(confidenceText(for: suggestion))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Merge") {
                                Task { await store.merge(suggestion) }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(store.isMutating)
                        }
                    }
                }

                ForEach(store.mergeEvents) { event in
                    DetailRow(
                        label: event.eventType.replacingOccurrences(of: "_", with: " ").capitalized,
                        value: DateFormatting.formatAbsoluteTime(event.createdAt)
                    )
                }
            }
        }
    }

    private func confidenceText(for suggestion: PersonMergeSuggestionDTO) -> String {
        let confidence = (suggestion.confidence * 100)
            .formatted(.number.precision(.fractionLength(0)))
        return "Confidence \(confidence)%"
    }
}
