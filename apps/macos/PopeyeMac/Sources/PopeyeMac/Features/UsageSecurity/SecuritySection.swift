import SwiftUI
import PopeyeAPI

struct SecuritySection: View {
    let audit: SecurityAuditDTO?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Security Audit")
                .font(.headline)
                .foregroundStyle(.secondary)
            if let audit, !audit.findings.isEmpty {
                AuditFindingsTable(findings: audit.findings)
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.shield")
                        .foregroundStyle(.green)
                    Text("No security findings")
                        .foregroundStyle(.secondary)
                }
                .font(.callout)
                .padding(.vertical, 12)
            }
        }
    }
}
