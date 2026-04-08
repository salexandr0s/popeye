import SwiftUI

struct AppRouteDestinationView: View {
    @Environment(AppModel.self) private var appModel
    let route: AppRoute

    var body: some View {
        switch route {
        case .home:
            HomeView(store: appModel.homeStore())
        case .dashboard:
            DashboardView(store: appModel.dashboardStore())
        case .commandCenter:
            CommandCenterView(store: appModel.commandCenterStore())
        case .setup:
            SetupView(store: appModel.setupStore())
        case .connections:
            ConnectionsOverviewView(store: appModel.connectionsStore())
        case .telegram:
            TelegramView(store: appModel.telegramStore())
        case .brain:
            BrainView(store: appModel.brainStore())
        case .memory:
            MemoryView(store: appModel.memoryStore())
        case .knowledge:
            KnowledgeView(store: appModel.knowledgeStore())
        case .playbooks:
            PlaybooksView(store: appModel.playbooksStore())
        case .instructionPreview:
            InstructionPreviewView(store: appModel.instructionPreviewStore())
        case .agentProfiles:
            AgentProfilesView(store: appModel.agentProfilesStore())
        case .automations:
            AutomationsView(store: appModel.automationStore())
        case .email:
            EmailView(store: appModel.emailStore())
        case .calendar:
            CalendarView(store: appModel.calendarStore())
        case .todos:
            TodosView(store: appModel.todosStore())
        case .people:
            PeopleView(store: appModel.peopleStore())
        case .files:
            FilesView(store: appModel.filesStore())
        case .github:
            GithubView(store: appModel.githubStore())
        case .finance:
            FinanceView(store: appModel.financeStore())
        case .medical:
            MedicalView(store: appModel.medicalStore())
        case .scheduler:
            SchedulerView(
                jobsStore: appModel.jobsStore(),
                dashboardStore: appModel.dashboardStore()
            )
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
        case .usageSecurity:
            UsageSecurityView(store: appModel.usageSecurityStore())
        }
    }
}
