import SwiftUI
import PopeyeAPI

struct AuditFindingsTable: View {
    let findings: [SecurityAuditFindingDTO]

    var body: some View {
        Table(findings) {
            TableColumn("Severity") { finding in
                StatusBadge(state: finding.severity)
            }
            .width(min: 70, ideal: 90)

            TableColumn("Code") { finding in
                Text(finding.code)
                    .font(.system(.callout, design: .monospaced))
            }
            .width(min: 100, ideal: 150)

            TableColumn("Message") { finding in
                Text(finding.message)
                    .lineLimit(2)
                    .truncationMode(.tail)
            }

            TableColumn("Observed") { finding in
                if let timestamp = finding.timestamp {
                    Text(DateFormatting.formatRelativeTime(timestamp))
                        .font(.caption)
                } else {
                    Text("--")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .width(min: 70, ideal: 90)
        }
        .frame(minHeight: 200)
    }
}
