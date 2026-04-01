import SwiftUI
import PopeyeAPI

@Observable @MainActor
final class AppModel {
    var connectionState: ConnectionState = .disconnected
    var selectedRoute: AppRoute?
    var baseURL: String {
        get { UserDefaults.standard.string(forKey: "baseURL") ?? "http://127.0.0.1:3210" }
        set { UserDefaults.standard.set(newValue, forKey: "baseURL") }
    }

    var badgeCounts: BadgeCounts = BadgeCounts()
    var sseConnected = false
    var workspaces: [WorkspaceRecordDTO] = []
    var selectedWorkspaceID: String = UserDefaults.standard.string(forKey: "selectedWorkspaceID") ?? "default" {
        didSet {
            UserDefaults.standard.set(selectedWorkspaceID, forKey: "selectedWorkspaceID")
            propagateWorkspaceSelection()
        }
    }

    var selectedWorkspace: WorkspaceRecordDTO? {
        workspaces.first { $0.id == selectedWorkspaceID }
    }

    // MARK: - Settings (backed by UserDefaults)

    var sseEnabled: Bool = UserDefaults.standard.object(forKey: "sseEnabled") as? Bool ?? true {
        didSet { UserDefaults.standard.set(sseEnabled, forKey: "sseEnabled") }
    }

    var pollIntervalSeconds: Int = UserDefaults.standard.object(forKey: "pollIntervalSeconds") as? Int ?? 15 {
        didSet { UserDefaults.standard.set(pollIntervalSeconds, forKey: "pollIntervalSeconds") }
    }

    private(set) var client: ControlAPIClient?
    private let credentialStore = CredentialStore()

    init() {
        if let raw = UserDefaults.standard.string(forKey: "selectedRoute"),
           let route = AppRoute(rawValue: raw) {
            selectedRoute = route
        } else {
            selectedRoute = .dashboard
        }
    }
    private var eventStream: EventStreamService?
    private var invalidationBus: InvalidationBus?
    private var sseTask: Task<Void, Never>?
    private var sseBridgeTask: Task<Void, Never>?

    // MARK: - Cached Stores (survive navigation)

    private var _dashboardStore: DashboardStore?
    private var _commandCenterStore: CommandCenterStore?
    private var _runsStore: RunsStore?
    private var _jobsStore: JobsStore?
    private var _receiptsStore: ReceiptsStore?
    private var _interventionsStore: InterventionsStore?
    private var _approvalsStore: ApprovalsStore?
    private var _connectionsStore: ConnectionsStore?
    private var _usageSecurityStore: UsageSecurityStore?
    private var _usageStore: UsageStore?
    private var _setupStore: SetupStore?
    private var _brainStore: BrainStore?
    private var _memoryStore: MemoryStore?
    private var _agentProfilesStore: AgentProfilesStore?
    private var _instructionPreviewStore: InstructionPreviewStore?
    private var _telegramStore: TelegramStore?

    struct BadgeCounts {
        var openInterventions: Int = 0
        var pendingApprovals: Int = 0
    }

    var isConnected: Bool {
        if case .connected = connectionState { return true }
        return false
    }

    // MARK: - Store Accessors

    /// Asserts a connected client exists. All store accessors are gated behind
    /// `AppShellView`'s `if appModel.client != nil` check, so this should never
    /// fail in practice.
    private var connectedClient: ControlAPIClient {
        guard let client else {
            fatalError("Store accessor called before connection established")
        }
        return client
    }

    func dashboardStore() -> DashboardStore {
        if let s = _dashboardStore { return s }
        let s = DashboardStore(service: SystemService(client: connectedClient), pollIntervalSeconds: pollIntervalSeconds)
        _dashboardStore = s
        return s
    }

    func commandCenterStore() -> CommandCenterStore {
        if let s = _commandCenterStore { return s }
        let s = CommandCenterStore(client: connectedClient, pollIntervalSeconds: pollIntervalSeconds)
        _commandCenterStore = s
        return s
    }

    func runsStore() -> RunsStore {
        if let s = _runsStore { return s }
        let s = RunsStore(client: connectedClient)
        _runsStore = s
        return s
    }

    func jobsStore() -> JobsStore {
        if let s = _jobsStore { return s }
        let s = JobsStore(client: connectedClient)
        _jobsStore = s
        return s
    }

    func receiptsStore() -> ReceiptsStore {
        if let s = _receiptsStore { return s }
        let s = ReceiptsStore(client: connectedClient)
        _receiptsStore = s
        return s
    }

    func interventionsStore() -> InterventionsStore {
        if let s = _interventionsStore { return s }
        let s = InterventionsStore(client: connectedClient)
        _interventionsStore = s
        return s
    }

    func approvalsStore() -> ApprovalsStore {
        if let s = _approvalsStore { return s }
        let s = ApprovalsStore(client: connectedClient)
        _approvalsStore = s
        return s
    }

    func connectionsStore() -> ConnectionsStore {
        if let s = _connectionsStore { return s }
        let s = ConnectionsStore(client: connectedClient)
        _connectionsStore = s
        return s
    }

    func usageSecurityStore() -> UsageSecurityStore {
        if let s = _usageSecurityStore { return s }
        let s = UsageSecurityStore(client: connectedClient)
        _usageSecurityStore = s
        return s
    }

    func usageStore() -> UsageStore {
        if let s = _usageStore { return s }
        let s = UsageStore(client: connectedClient)
        _usageStore = s
        return s
    }

    func setupStore() -> SetupStore {
        if let s = _setupStore { return s }
        let s = SetupStore(client: connectedClient)
        s.workspaceID = selectedWorkspaceID
        _setupStore = s
        return s
    }

    func brainStore() -> BrainStore {
        if let s = _brainStore { return s }
        let s = BrainStore(client: connectedClient)
        s.workspaceID = selectedWorkspaceID
        _brainStore = s
        return s
    }

    func memoryStore() -> MemoryStore {
        if let s = _memoryStore { return s }
        let s = MemoryStore(client: connectedClient)
        s.workspaceID = selectedWorkspaceID
        _memoryStore = s
        return s
    }

    func agentProfilesStore() -> AgentProfilesStore {
        if let s = _agentProfilesStore { return s }
        let s = AgentProfilesStore(client: connectedClient)
        _agentProfilesStore = s
        return s
    }

    func instructionPreviewStore() -> InstructionPreviewStore {
        if let s = _instructionPreviewStore { return s }
        let s = InstructionPreviewStore(client: connectedClient)
        s.adoptWorkspaceScope(selectedWorkspaceID)
        _instructionPreviewStore = s
        return s
    }

    func telegramStore() -> TelegramStore {
        if let s = _telegramStore { return s }
        let s = TelegramStore(client: connectedClient)
        _telegramStore = s
        return s
    }

    // MARK: - Cross-Navigation

    func navigateToRun(id: String) {
        runsStore().selectedRunId = id
        selectedRoute = .runs
    }

    func navigateToConnection(id: String?) {
        if let id {
            connectionsStore().selectedId = id
        }
        selectedRoute = .connections
    }

    func navigateToBrain() {
        selectedRoute = .brain
    }

    func navigateToInstructions() {
        selectedRoute = .instructionPreview
    }

    func navigateToMemory(id: String? = nil, preferredMode: MemoryStore.ViewMode? = nil) {
        let store = memoryStore()
        if let preferredMode {
            store.viewMode = preferredMode
        }
        if let id {
            store.selectedMemoryId = id
        }
        selectedRoute = .memory
    }

    func navigateToAgentProfiles() {
        selectedRoute = .agentProfiles
    }

    func navigateToTelegram() {
        selectedRoute = .telegram
    }

    // MARK: - Connection

    func connect(baseURL: String, token: String) async {
        self.baseURL = baseURL
        connectionState = .connecting

        let newClient = ControlAPIClient(baseURL: baseURL, token: token)

        do {
            _ = try await newClient.health()
            _ = try await newClient.status()
            try credentialStore.saveToken(token)
            client = newClient
            await refreshWorkspaces(using: newClient)
            connectionState = .connected
            if sseEnabled { startSSE() }
        } catch let error as APIError {
            connectionState = .failed(error)
        } catch {
            connectionState = .failed(.transportUnavailable)
        }
    }

    func disconnect() {
        stopSSE()
        client = nil
        clearStores()
        workspaces = []
        connectionState = .disconnected
        badgeCounts = BadgeCounts()
        try? credentialStore.deleteToken()
    }

    func restoreSession() async {
        guard let token = try? credentialStore.retrieveToken() else { return }
        await connect(baseURL: baseURL, token: token)
    }

    private func refreshWorkspaces(using client: ControlAPIClient) async {
        let service = SystemService(client: client)
        do {
            let loadedWorkspaces = try await service.loadWorkspaces()
            workspaces = loadedWorkspaces
            if loadedWorkspaces.contains(where: { $0.id == selectedWorkspaceID }) == false {
                selectedWorkspaceID = loadedWorkspaces.first?.id ?? "default"
            } else {
                propagateWorkspaceSelection()
            }
        } catch {
            workspaces = []
            selectedWorkspaceID = "default"
        }
    }

    private func propagateWorkspaceSelection() {
        _setupStore?.workspaceID = selectedWorkspaceID
        _brainStore?.workspaceID = selectedWorkspaceID
        _memoryStore?.workspaceID = selectedWorkspaceID
        _instructionPreviewStore?.adoptWorkspaceScope(selectedWorkspaceID)
    }

    private func clearStores() {
        _dashboardStore?.stopPolling()
        _commandCenterStore?.stopPolling()
        _dashboardStore = nil
        _commandCenterStore = nil
        _runsStore = nil
        _jobsStore = nil
        _receiptsStore = nil
        _interventionsStore = nil
        _approvalsStore = nil
        _connectionsStore = nil
        _usageSecurityStore = nil
        _usageStore = nil
        _setupStore = nil
        _brainStore = nil
        _memoryStore = nil
        _agentProfilesStore = nil
        _instructionPreviewStore = nil
        _telegramStore = nil
    }

    // MARK: - SSE

    private func startSSE() {
        guard let client else { return }
        let stream = EventStreamService(client: client)
        let bus = InvalidationBus()
        eventStream = stream
        invalidationBus = bus

        sseTask = Task { [weak self] in
            let events = await stream.start()
            for await event in events {
                await bus.processEvent(event)
                self?.updateSSEState(connected: true)
            }
            self?.updateSSEState(connected: false)
        }

        sseBridgeTask = Task { [weak self] in
            let signals = await bus.subscribe()
            for await signal in signals {
                NotificationCenter.default.post(
                    name: .popeyeInvalidation,
                    object: signal
                )
                self?.updateBadgeCounts(for: signal)
            }
        }
    }

    private func stopSSE() {
        sseTask?.cancel()
        sseTask = nil
        sseBridgeTask?.cancel()
        sseBridgeTask = nil
        let stream = eventStream
        let bus = invalidationBus
        eventStream = nil
        invalidationBus = nil
        sseConnected = false
        Task {
            await stream?.stop()
            await bus?.stop()
        }
    }

    private func updateSSEState(connected: Bool) {
        sseConnected = connected
    }

    private func updateBadgeCounts(for signal: InvalidationSignal) {
        guard let client else { return }
        switch signal {
        case .interventions, .general:
            Task {
                let interventions: [InterventionDTO] = (try? await client.listInterventions()) ?? []
                badgeCounts.openInterventions = interventions.count(where: { $0.status == "open" })
            }
        case .approvals:
            Task {
                let approvals: [ApprovalDTO] = (try? await client.listApprovals()) ?? []
                badgeCounts.pendingApprovals = approvals.count(where: { $0.status == "pending" })
            }
        default:
            break
        }
    }
}
