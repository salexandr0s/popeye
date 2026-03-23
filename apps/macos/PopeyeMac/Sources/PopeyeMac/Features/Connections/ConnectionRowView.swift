import SwiftUI
import PopeyeAPI

struct ConnectionRowView: View {
    let connection: ConnectionDTO

    var body: some View {
        HStack(spacing: 8) {
            StatusBadge(state: connection.health?.status ?? "unknown")
            VStack(alignment: .leading, spacing: 2) {
                Text(connection.label)
                    .font(.callout.weight(.medium))
                HStack(spacing: 4) {
                    Text(connection.domain)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let sync = connection.sync {
                        Text(sync.status)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            Spacer()
        }
        .padding(.vertical, 2)
    }
}
