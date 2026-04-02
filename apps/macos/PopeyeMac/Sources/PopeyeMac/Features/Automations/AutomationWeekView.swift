import SwiftUI
import PopeyeAPI

struct AutomationWeekView: View {
    let automations: [AutomationRecordDTO]
    let selectedAutomationID: String?
    let onSelect: (String) -> Void

    private var days: [Date] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: .now)
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(days, id: \.self) { day in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(DateFormatting.formatWeekday(day))
                            .font(.headline)
                        Text(DateFormatting.formatDayMonth(day))
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        ForEach(entries(for: day), id: \ .id) { entry in
                            Button {
                                onSelect(entry.id)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(entry.title)
                                        .font(.callout.weight(.medium))
                                        .lineLimit(2)
                                    Text(entry.timeLabel)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                                .background(entry.id == selectedAutomationID ? Color.accentColor.opacity(0.15) : Color.secondary.opacity(0.08))
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }

                        if entries(for: day).isEmpty {
                            Text("Nothing expected")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .padding(.top, 8)
                        }
                    }
                    .frame(width: 220, alignment: .topLeading)
                    .padding(12)
                    .background(.background.secondary)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private func entries(for day: Date) -> [WeekEntry] {
        projectedEntries
            .filter { Calendar.current.isDate($0.date, inSameDayAs: day) }
            .sorted { $0.date < $1.date }
    }

    private var projectedEntries: [WeekEntry] {
        let end = Calendar.current.date(byAdding: .day, value: 7, to: Calendar.current.startOfDay(for: .now)) ?? .now
        var entries: [WeekEntry] = []
        for automation in automations {
            guard let nextExpectedAt = automation.nextExpectedAt,
                  let nextDate = DateFormatting.parseISO8601(nextExpectedAt)
            else { continue }

            if let intervalSeconds = automation.intervalSeconds {
                var cursor = nextDate
                while cursor < end {
                    entries.append(WeekEntry(id: automation.id, title: automation.title, date: cursor))
                    cursor = cursor.addingTimeInterval(TimeInterval(intervalSeconds))
                }
            } else {
                entries.append(WeekEntry(id: automation.id, title: automation.title, date: nextDate))
            }
        }
        return entries
    }
}

private struct WeekEntry: Identifiable {
    let id: String
    let title: String
    let date: Date

    var timeLabel: String {
        DateFormatting.formatAbsoluteTime(date)
    }
}
