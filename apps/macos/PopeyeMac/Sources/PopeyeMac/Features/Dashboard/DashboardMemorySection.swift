import SwiftUI
import PopeyeAPI

struct DashboardMemorySection: View {
    let snapshot: DashboardSnapshot

    private var columns: [GridItem] {
        PopeyeUI.cardColumns(minimum: 200, maximum: 280)
    }

    var body: some View {
        if let audit = snapshot.memoryAudit {
            VStack(alignment: .leading, spacing: 8) {
                Text("Memory")
                    .font(.headline)
                    .foregroundStyle(.secondary)

                LazyVGrid(columns: columns, spacing: PopeyeUI.cardSpacing) {
                    MemoryAuditCard(audit: audit)
                }
            }
        }
    }
}
