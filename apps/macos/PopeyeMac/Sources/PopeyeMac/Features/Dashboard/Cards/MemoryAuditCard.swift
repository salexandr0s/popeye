import SwiftUI
import PopeyeAPI

struct MemoryAuditCard: View {
    let audit: MemoryAuditDTO

    var body: some View {
        DashboardCard(
            label: "Memory",
            value: "\(audit.activeMemories)",
            description: typeSummary,
            valueColor: healthColor
        )
    }

    private var typeSummary: String {
        let parts = audit.byType.sorted(by: { $0.value > $1.value }).prefix(3).map { "\($0.value) \($0.key)" }
        if parts.isEmpty { return "No memories" }
        return parts.joined(separator: ", ")
    }

    private var healthColor: Color {
        if audit.staleCount > audit.activeMemories / 2 { return .orange }
        if audit.activeMemories == 0 { return .secondary }
        return .primary
    }
}
