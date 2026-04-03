import Foundation
import PopeyeAPI

@MainActor
final class AppStoreRegistry {
    private let clientProvider: () -> ControlAPIClient?
    private let workspaceIDProvider: () -> String
    private let pollIntervalProvider: () -> Int

    private var dashboardStore: DashboardStore?
    private var commandCenterStore: CommandCenterStore?
    private var runsStore: RunsStore?
    private var jobsStore: JobsStore?
    private var receiptsStore: ReceiptsStore?
    private var interventionsStore: InterventionsStore?
    private var approvalsStore: ApprovalsStore?
    private var connectionsStore: ConnectionsStore?
    private var usageSecurityStore: UsageSecurityStore?
    private var usageStore: UsageStore?
    private var setupStore: SetupStore?
    private var brainStore: BrainStore?
    private var memoryStore: MemoryStore?
    private var agentProfilesStore: AgentProfilesStore?
    private var instructionPreviewStore: InstructionPreviewStore?
    private var automationStore: AutomationStore?
    private var homeStore: HomeStore?
    private var emailStore: EmailStore?
    private var calendarStore: CalendarStore?
    private var todosStore: TodosStore?
    private var peopleStore: PeopleStore?
    private var filesStore: FilesStore?
    private var financeStore: FinanceStore?
    private var medicalStore: MedicalStore?
    private var telegramStore: TelegramStore?

    init(
        clientProvider: @escaping () -> ControlAPIClient?,
        workspaceIDProvider: @escaping () -> String,
        pollIntervalProvider: @escaping () -> Int
    ) {
        self.clientProvider = clientProvider
        self.workspaceIDProvider = workspaceIDProvider
        self.pollIntervalProvider = pollIntervalProvider
    }

    func dashboard() -> DashboardStore {
        if let dashboardStore { return dashboardStore }
        let store = DashboardStore(
            service: SystemService(client: connectedClient()),
            pollIntervalSeconds: pollIntervalProvider()
        )
        dashboardStore = store
        return store
    }

    func commandCenter() -> CommandCenterStore {
        if let commandCenterStore { return commandCenterStore }
        let store = CommandCenterStore(
            client: connectedClient(),
            pollIntervalSeconds: pollIntervalProvider()
        )
        commandCenterStore = store
        return store
    }

    func runs() -> RunsStore {
        if let runsStore { return runsStore }
        let store = RunsStore(client: connectedClient())
        runsStore = store
        return store
    }

    func jobs() -> JobsStore {
        if let jobsStore { return jobsStore }
        let store = JobsStore(client: connectedClient())
        jobsStore = store
        return store
    }

    func receipts() -> ReceiptsStore {
        if let receiptsStore { return receiptsStore }
        let store = ReceiptsStore(client: connectedClient())
        receiptsStore = store
        return store
    }

    func interventions() -> InterventionsStore {
        if let interventionsStore { return interventionsStore }
        let store = InterventionsStore(client: connectedClient())
        interventionsStore = store
        return store
    }

    func approvals() -> ApprovalsStore {
        if let approvalsStore { return approvalsStore }
        let store = ApprovalsStore(client: connectedClient())
        approvalsStore = store
        return store
    }

    func connections() -> ConnectionsStore {
        if let connectionsStore { return connectionsStore }
        let store = ConnectionsStore(client: connectedClient())
        connectionsStore = store
        return store
    }

    func usageSecurity() -> UsageSecurityStore {
        if let usageSecurityStore { return usageSecurityStore }
        let store = UsageSecurityStore(client: connectedClient())
        usageSecurityStore = store
        return store
    }

    func usage() -> UsageStore {
        if let usageStore { return usageStore }
        let store = UsageStore(client: connectedClient())
        usageStore = store
        return store
    }

    func setup() -> SetupStore {
        if let setupStore { return setupStore }
        let store = SetupStore(client: connectedClient())
        store.workspaceID = workspaceIDProvider()
        setupStore = store
        return store
    }

    func brain() -> BrainStore {
        if let brainStore { return brainStore }
        let store = BrainStore(client: connectedClient())
        store.workspaceID = workspaceIDProvider()
        brainStore = store
        return store
    }

    func memory() -> MemoryStore {
        if let memoryStore { return memoryStore }
        let store = MemoryStore(client: connectedClient())
        store.workspaceID = workspaceIDProvider()
        memoryStore = store
        return store
    }

    func agentProfiles() -> AgentProfilesStore {
        if let agentProfilesStore { return agentProfilesStore }
        let store = AgentProfilesStore(client: connectedClient())
        agentProfilesStore = store
        return store
    }

    func instructionPreview() -> InstructionPreviewStore {
        if let instructionPreviewStore { return instructionPreviewStore }
        let store = InstructionPreviewStore(client: connectedClient())
        store.adoptWorkspaceScope(workspaceIDProvider())
        instructionPreviewStore = store
        return store
    }

    func automations() -> AutomationStore {
        if let automationStore { return automationStore }
        let store = AutomationStore(client: connectedClient())
        store.workspaceID = workspaceIDProvider()
        automationStore = store
        return store
    }

    func home() -> HomeStore {
        if let homeStore { return homeStore }
        let store = HomeStore(client: connectedClient())
        store.workspaceID = workspaceIDProvider()
        homeStore = store
        return store
    }

    func email() -> EmailStore {
        if let emailStore { return emailStore }
        let store = EmailStore(client: connectedClient())
        store.workspaceID = workspaceIDProvider()
        emailStore = store
        return store
    }

    func calendar() -> CalendarStore {
        if let calendarStore { return calendarStore }
        let store = CalendarStore(client: connectedClient())
        store.workspaceID = workspaceIDProvider()
        calendarStore = store
        return store
    }

    func todos() -> TodosStore {
        if let todosStore { return todosStore }
        let store = TodosStore(client: connectedClient())
        store.workspaceID = workspaceIDProvider()
        todosStore = store
        return store
    }

    func people() -> PeopleStore {
        if let peopleStore { return peopleStore }
        let store = PeopleStore(client: connectedClient())
        peopleStore = store
        return store
    }

    func files() -> FilesStore {
        if let filesStore { return filesStore }
        let store = FilesStore(client: connectedClient())
        store.workspaceID = workspaceIDProvider()
        filesStore = store
        return store
    }

    func finance() -> FinanceStore {
        if let financeStore { return financeStore }
        let store = FinanceStore(client: connectedClient())
        financeStore = store
        return store
    }

    func medical() -> MedicalStore {
        if let medicalStore { return medicalStore }
        let store = MedicalStore(client: connectedClient())
        medicalStore = store
        return store
    }

    func telegram() -> TelegramStore {
        if let telegramStore { return telegramStore }
        let store = TelegramStore(client: connectedClient())
        telegramStore = store
        return store
    }

    func propagateWorkspaceSelection(_ selectedWorkspaceID: String) {
        setupStore?.workspaceID = selectedWorkspaceID
        brainStore?.workspaceID = selectedWorkspaceID
        memoryStore?.workspaceID = selectedWorkspaceID
        instructionPreviewStore?.adoptWorkspaceScope(selectedWorkspaceID)
        automationStore?.workspaceID = selectedWorkspaceID
        homeStore?.workspaceID = selectedWorkspaceID
        emailStore?.workspaceID = selectedWorkspaceID
        calendarStore?.workspaceID = selectedWorkspaceID
        todosStore?.workspaceID = selectedWorkspaceID
        filesStore?.workspaceID = selectedWorkspaceID
    }

    func reconfigurePollingStores() {
        dashboardStore?.stopPolling()
        commandCenterStore?.stopPolling()
        dashboardStore = nil
        commandCenterStore = nil
    }

    func reset() {
        dashboardStore?.stopPolling()
        commandCenterStore?.stopPolling()

        dashboardStore = nil
        commandCenterStore = nil
        runsStore = nil
        jobsStore = nil
        receiptsStore = nil
        interventionsStore = nil
        approvalsStore = nil
        connectionsStore = nil
        usageSecurityStore = nil
        usageStore = nil
        setupStore = nil
        brainStore = nil
        memoryStore = nil
        agentProfilesStore = nil
        instructionPreviewStore = nil
        automationStore = nil
        homeStore = nil
        emailStore = nil
        calendarStore = nil
        todosStore = nil
        peopleStore = nil
        filesStore = nil
        financeStore = nil
        medicalStore = nil
        telegramStore = nil
    }

    private func connectedClient() -> ControlAPIClient {
        guard let client = clientProvider() else {
            fatalError("Store accessor called before connection established")
        }

        return client
    }
}
