import Foundation

public enum DateFormatting {
    public static func parseISO8601(_ string: String) -> Date? {
        if let date = try? Date(string, strategy: .iso8601.year().month().day()
            .time(includingFractionalSeconds: true).timeZone(separator: .omitted)) {
            return date
        }
        return try? Date(string, strategy: .iso8601)
    }

    public static func formatRelativeTime(_ date: Date) -> String {
        let seconds = max(0, Int(Date.now.timeIntervalSince(date)))

        if seconds < 5 { return "just now" }
        if seconds < 60 { return "\(seconds)s ago" }

        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }

        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }

        let days = hours / 24
        return "\(days)d ago"
    }

    public static func formatRelativeTime(_ isoString: String) -> String {
        guard let date = parseISO8601(isoString) else { return "--" }
        let seconds = max(0, Int(Date.now.timeIntervalSince(date)))

        if seconds < 5 { return "just now" }
        if seconds < 60 { return "\(seconds)s ago" }

        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }

        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }

        let days = hours / 24
        return "\(days)d ago"
    }

    public static func formatAbsoluteTime(_ isoString: String) -> String {
        guard let date = parseISO8601(isoString) else { return "--" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
