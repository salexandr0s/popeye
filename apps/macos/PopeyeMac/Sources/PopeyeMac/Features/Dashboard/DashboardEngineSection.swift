import SwiftUI
import PopeyeAPI

struct DashboardEngineSection: View {
    let snapshot: DashboardSnapshot

    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 200, maximum: 280)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Engine Capabilities")
                .font(.headline)
                .foregroundStyle(.secondary)

            LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
                HostToolsCard(capabilities: snapshot.capabilities)
                SessionsCard(capabilities: snapshot.capabilities)
                CompactionCard(capabilities: snapshot.capabilities)

                if let audit = snapshot.securityAudit {
                    SecurityCard(audit: audit)
                }
            }
        }
    }
}
