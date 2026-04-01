import SwiftUI
import PopeyeAPI

struct MemoryDailyView: View {
    @Bindable var store: MemoryStore

    var body: some View {
        HSplitView {
            dayList
                .frame(minWidth: 220, idealWidth: 240, maxWidth: 280)
            timelineList
                .frame(minWidth: 320)
        }
    }

    private var dayList: some View {
        Group {
            if store.dayGroups.isEmpty {
                ContentUnavailableView("No daily memories yet", systemImage: "calendar")
            } else {
                List(store.dayGroups, selection: $store.selectedDayID) { group in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(group.title)
                            .font(.headline)
                        Text(group.subtitle)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                    .tag(group.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private var timelineList: some View {
        Group {
            if let group = store.selectedDayGroup {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(group.title)
                                .font(.title3.bold())
                            Text(group.subtitle)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(16)

                    Divider()

                    List(group.memories, selection: $store.selectedMemoryId) { memory in
                        MemoryTimelineRowView(memory: memory)
                    }
                    .listStyle(.inset)
                }
            } else {
                ContentUnavailableView("Choose a day", systemImage: "calendar.badge.clock")
            }
        }
    }
}

private struct MemoryTimelineRowView: View {
    let memory: MemoryRecordDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(memory.description)
                    .lineLimit(2)
                Spacer()
                Text(DateFormatting.formatAbsoluteTime(memory.sourceTimestamp ?? memory.createdAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                StatusBadge(state: memory.memoryType)
                Text(memory.domain)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(memory.confidence, format: .percent.precision(.fractionLength(0)))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}
