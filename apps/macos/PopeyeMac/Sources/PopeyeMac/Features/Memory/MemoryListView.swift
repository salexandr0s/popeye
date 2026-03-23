import SwiftUI
import PopeyeAPI

struct MemoryListView: View {
    @Bindable var store: MemoryStore

    var body: some View {
        Group {
            if store.filteredMemories.isEmpty {
                EmptyStateView(
                    icon: "brain",
                    title: "No memories",
                    description: "Memories appear as the agent processes tasks."
                )
            } else {
                memoryTable
            }
        }
    }

    private var memoryTable: some View {
        Table(store.filteredMemories, selection: $store.selectedMemoryId) {
            TableColumn("Description") { memory in
                Text(memory.description)
                    .lineLimit(2)
            }
            .width(min: 150)

            TableColumn("Type") { memory in
                StatusBadge(state: memory.memoryType)
            }
            .width(80)

            TableColumn("Confidence") { memory in
                Text(memory.confidence, format: .percent.precision(.fractionLength(0)))
                    .monospacedDigit()
            }
            .width(70)

            TableColumn("Domain") { memory in
                Text(memory.domain)
            }
            .width(70)

            TableColumn("Created") { memory in
                Text(DateFormatting.formatRelativeTime(memory.createdAt))
            }
            .width(80)
        }
    }

}
