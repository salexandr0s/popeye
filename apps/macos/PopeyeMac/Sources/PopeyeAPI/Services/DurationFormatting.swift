import Foundation

public enum DurationFormatting {
    public static func formatUptime(since isoString: String) -> String {
        guard let start = DateFormatting.parseISO8601(isoString) else { return "--" }
        let seconds = Date.now.timeIntervalSince(start)
        return formatDuration(seconds)
    }

    public static func formatDuration(_ totalSeconds: TimeInterval) -> String {
        let s = Int(max(0, totalSeconds))
        if s < 60 { return "\(s)s" }

        let minutes = s / 60
        let secs = s % 60
        if minutes < 60 { return "\(minutes)m \(secs)s" }

        let hours = minutes / 60
        let mins = minutes % 60
        if hours < 24 { return "\(hours)h \(mins)m" }

        let days = hours / 24
        let hrs = hours % 24
        return "\(days)d \(hrs)h"
    }
}
