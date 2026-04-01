import Foundation
import PopeyeAPI

struct MemoryDayGroup: Identifiable {
    let dayStart: Date
    let memories: [MemoryRecordDTO]

    var id: String {
        dayStart.formatted(.iso8601.year().month().day())
    }

    var title: String {
        dayStart.formatted(date: .abbreviated, time: .omitted)
    }

    var subtitle: String {
        "\(memories.count) memor\(memories.count == 1 ? "y" : "ies")"
    }
}

enum MemoryDayGrouper {
    static func group(memories: [MemoryRecordDTO], calendar: Calendar = .current) -> [MemoryDayGroup] {
        Dictionary(grouping: memories, by: { memory in
            let date = memoryDate(for: memory) ?? .distantPast
            return calendar.startOfDay(for: date)
        })
        .map { dayStart, dayMemories in
            MemoryDayGroup(
                dayStart: dayStart,
                memories: dayMemories.sorted { left, right in
                    guard let leftDate = memoryDate(for: left),
                          let rightDate = memoryDate(for: right) else {
                        return left.id > right.id
                    }
                    return leftDate > rightDate
                }
            )
        }
        .sorted { $0.dayStart > $1.dayStart }
    }

    static func memoryDate(for memory: MemoryRecordDTO) -> Date? {
        DateFormatting.parseISO8601(memory.sourceTimestamp ?? memory.createdAt)
    }
}
