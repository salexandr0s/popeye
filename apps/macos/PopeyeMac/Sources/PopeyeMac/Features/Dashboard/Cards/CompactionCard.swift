import SwiftUI
import PopeyeAPI

struct CompactionCard: View {
    let capabilities: EngineCapabilitiesDTO

    var body: some View {
        DashboardCard(
            label: "Compaction",
            value: capabilities.compactionEventSupport ? "Supported" : "Unavailable",
            description: capabilities.warnings.first
        )
    }
}
