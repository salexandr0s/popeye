import SwiftUI

struct AppSidebar: View {
    @Binding var selection: AppRoute?
    @Environment(AppModel.self) private var appModel

    var body: some View {
        List(selection: $selection) {
            ForEach(RouteGroup.allCases) { group in
                Section(group.title) {
                    ForEach(group.routes) { route in
                        Label(route.title, systemImage: route.systemImage)
                            .tag(route)
                            .badge(badgeCount(for: route))
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 280)
    }

    private func badgeCount(for route: AppRoute) -> Int {
        switch route {
        case .interventions: appModel.badgeCounts.openInterventions
        case .approvals: appModel.badgeCounts.pendingApprovals
        default: 0
        }
    }
}

#Preview {
    NavigationSplitView {
        AppSidebar(selection: .constant(.dashboard))
            .environment(AppModel())
    } content: {
        Text("Content")
    } detail: {
        Text("Detail")
    }
}
