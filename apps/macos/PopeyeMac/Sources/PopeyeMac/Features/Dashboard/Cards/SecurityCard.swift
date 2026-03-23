import SwiftUI
import PopeyeAPI

struct SecurityCard: View {
    let audit: SecurityAuditDTO

    var body: some View {
        DashboardCard(
            label: "Security",
            value: audit.findings.isEmpty ? "Clean" : "\(audit.findings.count) finding\(audit.findings.count == 1 ? "" : "s")",
            description: highestSeverityDescription,
            valueColor: valueColor
        )
    }

    private var highestSeverityDescription: String? {
        let errors = audit.findings.count(where: { $0.severity == "error" })
        let warnings = audit.findings.count(where: { $0.severity == "warn" })
        if errors > 0 { return "\(errors) error\(errors == 1 ? "" : "s")" }
        if warnings > 0 { return "\(warnings) warning\(warnings == 1 ? "" : "s")" }
        return nil
    }

    private var valueColor: Color {
        if audit.findings.contains(where: { $0.severity == "error" }) { return .red }
        if audit.findings.contains(where: { $0.severity == "warn" }) { return .orange }
        return .green
    }
}
