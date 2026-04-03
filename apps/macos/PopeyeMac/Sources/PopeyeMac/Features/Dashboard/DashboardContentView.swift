import SwiftUI
import PopeyeAPI

struct DashboardContentView: View {
    let snapshot: DashboardSnapshot
    let lastUpdated: Date?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                DashboardHeaderRow(lastUpdated: lastUpdated)
                DashboardHealthSection(snapshot: snapshot)
                DashboardSchedulerSection(snapshot: snapshot)
                DashboardEngineSection(snapshot: snapshot)
                DashboardMemorySection(snapshot: snapshot)
            }
            .padding(PopeyeUI.contentPadding)
        }
    }
}
