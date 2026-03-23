import Foundation

public enum IdentifierFormatting {
    public static func formatTokenCount(_ count: Int) -> String {
        count.formatted(.number.grouping(.automatic))
    }

    public static func formatShortID(_ id: String) -> String {
        if id.count <= 8 { return id }
        return String(id.prefix(8)) + "…"
    }
}
