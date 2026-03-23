import SwiftUI
import PopeyeAPI

struct AppShellView: View {
    @Environment(AppModel.self) private var appModel
    // Route persistence handled by AppModel init + onChange below

    var body: some View {
        @Bindable var model = appModel
        NavigationSplitView {
            AppSidebar(selection: $model.selectedRoute)
        } detail: {
            Group {
                if appModel.client != nil {
                    switch appModel.selectedRoute {
                    case .dashboard, nil:
                        DashboardView(store: appModel.dashboardStore())
                    case .commandCenter:
                        CommandCenterView(store: appModel.commandCenterStore())
                    case .usage:
                        UsageView(store: appModel.usageStore())
                    case .runs:
                        RunsView(store: appModel.runsStore())
                    case .jobs:
                        JobsView(store: appModel.jobsStore())
                    case .receipts:
                        ReceiptsView(store: appModel.receiptsStore())
                    case .interventions:
                        InterventionsView(store: appModel.interventionsStore())
                    case .approvals:
                        ApprovalsView(store: appModel.approvalsStore())
                    case .connections:
                        ConnectionsOverviewView(store: appModel.connectionsStore())
                    case .usageSecurity:
                        UsageSecurityView(store: appModel.usageSecurityStore())
                    case .memory:
                        MemoryView(store: appModel.memoryStore())
                    case .instructionPreview:
                        InstructionPreviewView(store: appModel.instructionPreviewStore())
                    case .agentProfiles:
                        AgentProfilesView(store: appModel.agentProfilesStore())
                    }
                } else {
                    PlaceholderView(route: .dashboard)
                }
            }
        }
        .toolbar {
            AppToolbar()
        }
        .onChange(of: appModel.selectedRoute) { _, newRoute in
            UserDefaults.standard.set(newRoute?.rawValue, forKey: "selectedRoute")
        }
    }
}

#Preview {
    AppShellView()
        .environment(AppModel())
}
