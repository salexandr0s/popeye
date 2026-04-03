import SwiftUI
import PopeyeAPI

struct MemoryInspectorProvenanceSection: View {
    let memory: MemoryRecordDTO

    var body: some View {
        InspectorSection(title: "Provenance") {
            DetailRow(label: "Source Type", value: memory.sourceType)
            DetailRow(label: "Domain", value: memory.domain)
            DetailRow(label: "Confidence", value: memory.confidence.formatted(.percent.precision(.fractionLength(1))))
            DetailRow(label: "Context Release", value: formatted(memory.contextReleasePolicy))
            if let runId = memory.sourceRunId {
                CopyableRow(label: "Source Run", value: runId)
            }
            if let ts = memory.sourceTimestamp {
                DetailRow(label: "Source Time", value: DateFormatting.formatAbsoluteTime(ts))
            }
            DetailRow(label: "Created", value: DateFormatting.formatAbsoluteTime(memory.createdAt))
            if let reinforced = memory.lastReinforcedAt {
                DetailRow(label: "Last Reinforced", value: DateFormatting.formatRelativeTime(reinforced))
            }
            if let archived = memory.archivedAt {
                DetailRow(label: "Archived", value: DateFormatting.formatAbsoluteTime(archived))
            }
        }
    }

    private func formatted(_ value: String) -> String {
        value.replacingOccurrences(of: "_", with: " ").capitalized
    }
}
