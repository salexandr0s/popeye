import SwiftUI
import PopeyeAPI

struct MemoryInspectorSummarySection: View {
    let memory: MemoryRecordDTO

    var body: some View {
        InspectorSection(title: "Memory") {
            CopyableRow(label: "ID", value: memory.id)
            DetailRow(label: "Description", value: memory.description)

            HStack(spacing: 8) {
                StatusBadge(state: memory.memoryType)
                StatusBadge(state: memory.scope)
                StatusBadge(state: memory.classification)
                if memory.durable {
                    StatusBadge(state: "active")
                }
                if memory.archivedAt != nil {
                    StatusBadge(state: "expired")
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Memory summary")
            .accessibilityValue(summaryValue)
        }
    }

    private var summaryValue: String {
        var parts = [
            memory.memoryType.replacingOccurrences(of: "_", with: " ").capitalized,
            memory.scope.replacingOccurrences(of: "_", with: " ").capitalized,
            memory.classification.replacingOccurrences(of: "_", with: " ").capitalized,
        ]

        if memory.durable {
            parts.append("Active")
        }

        if memory.archivedAt != nil {
            parts.append("Expired")
        }

        return parts.joined(separator: ", ")
    }
}
