import SwiftUI
import PopeyeAPI

struct HomeMemorySection: View {
    let recentMemories: [MemoryRecordDTO]
    let openMemory: (String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recent Memory")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Open Memory") {
                    openMemory(nil)
                }
                .buttonStyle(.link)
            }

            if recentMemories.isEmpty {
                EmptyStateView(
                    icon: "brain",
                    title: "No recent memory yet",
                    description: "Memories will appear here as Popeye captures daily activity and promoted knowledge."
                )
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(recentMemories.prefix(6)) { memory in
                        Button {
                            openMemory(memory.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(memory.description)
                                        .font(.headline)
                                        .multilineTextAlignment(.leading)
                                    Spacer()
                                    StatusBadge(state: memory.memoryType)
                                }
                                Text(memory.domain.capitalized)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(memory.sourceTimestamp ?? memory.createdAt)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(.background.secondary)
                            .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(memory.description)
                        .accessibilityValue(accessibilityValue(for: memory))
                    }
                }
            }
        }
    }

    private func accessibilityValue(for memory: MemoryRecordDTO) -> String {
        [
            memory.memoryType.replacingOccurrences(of: "_", with: " ").capitalized,
            memory.domain.capitalized,
            memory.sourceTimestamp ?? memory.createdAt
        ]
        .joined(separator: ", ")
    }
}
