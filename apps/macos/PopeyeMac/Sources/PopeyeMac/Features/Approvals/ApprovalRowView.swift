import SwiftUI
import PopeyeAPI

struct ApprovalRowView: View {
    let approval: ApprovalDTO

    var body: some View {
        HStack(spacing: 8) {
            StatusBadge(state: approval.status)
            VStack(alignment: .leading, spacing: 2) {
                Text(approval.scope.replacing("_", with: " ").capitalized)
                    .font(.callout.weight(.medium))
                HStack(spacing: 4) {
                    Text(approval.domain)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(approval.resourceType)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer()
            Text(approval.requestedBy)
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }
}
