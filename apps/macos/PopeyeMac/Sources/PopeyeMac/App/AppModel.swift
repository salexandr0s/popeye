import SwiftUI
import Observation
import PopeyeAPI

@Observable @MainActor
final class AppModel {
    let navigation: AppNavigationModel
    let workspace: WorkspaceContext

    var connectionState: ConnectionState = .disconnected
    var bootstrapStatus: LocalBootstrapStatus?
    var bootstrapErrorMessage: String?
    var isBootstrapBusy = false
    var baseURL: String {
        get { UserDefaults.standard.string(forKey: StorageKey.baseURL) ?? "http://127.0.0.1:3210" }
        set { UserDefaults.standard.set(newValue, forKey: StorageKey.baseURL) }
    }

    var badgeCounts = BadgeCounts()
    var sseConnected = false
    var selectedRoute: AppRoute? {
        get { navigation.selectedRoute }
        set { navigation.selectedRoute = newValue }
    }
    var workspaces: [WorkspaceRecordDTO] { workspace.workspaces }
    var selectedWorkspaceID: String {
        get { workspace.selectedWorkspaceID }
        set { workspace.selectedWorkspaceID = newValue }
    }
    var selectedWorkspace: WorkspaceRecordDTO? { workspace.selectedWorkspace }

    // MARK: - Settings (backed by UserDefaults)

    var sseEnabled: Bool = UserDefaults.standard.object(forKey: StorageKey.sseEnabled) as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(sseEnabled, forKey: StorageKey.sseEnabled)
            guard isConnected else { return }
            if sseEnabled {
                startSSE()
            } else {
                stopSSE()
            }
        }
    }

    var pollIntervalSeconds: Int = UserDefaults.standard.object(forKey: StorageKey.pollIntervalSeconds) as? Int ?? 15 {
        didSet {
            UserDefaults.standard.set(pollIntervalSeconds, forKey: StorageKey.pollIntervalSeconds)
            stores.reconfigurePollingStores()
        }
    }

    private(set) var client: ControlAPIClient?
    @ObservationIgnored
    private let credentialStore: CredentialStore
    @ObservationIgnored
    private let localBootstrapService: LocalBootstrapService
    @ObservationIgnored
    private var activeCredentialKind: StoredCredentialKind?
    @ObservationIgnored
    private var stores: AppStoreRegistry! = nil
    @ObservationIgnored
    private var eventStream: EventStreamService?
    @ObservationIgnored
    private var invalidationBus: InvalidationBus?
    @ObservationIgnored
    private var sseTask: Task<Void, Never>?
    @ObservationIgnored
    private var sseBridgeTask: Task<Void, Never>?

    init(
        navigation: AppNavigationModel = AppNavigationModel(),
        workspace: WorkspaceContext = WorkspaceContext(),
        credentialStore: CredentialStore = CredentialStore(),
        localBootstrapService: LocalBootstrapService = LocalBootstrapService()
    ) {
        self.navigation = navigation
        self.workspace = workspace
        self.credentialStore = credentialStore
        self.localBootstrapService = localBootstrapService
        self.stores = AppStoreRegistry(
            clientProvider: { [weak self] in self?.client },
            workspaceIDProvider: { [weak self] in self?.selectedWorkspaceID ?? "default" },
            pollIntervalProvider: { [weak self] in self?.pollIntervalSeconds ?? 15 }
        )

        self.workspace.onSelectionChanged = { [weak self] selectedWorkspaceID in
            self?.stores.propagateWorkspaceSelection(selectedWorkspaceID)
        }
    }

    struct BadgeCounts {
        var openInterventions = 0
        var pendingApprovals = 0
    }

    var isConnected: Bool {
        if case .connected = connectionState { return true }
        return false
    }

    var connectErrorMessage: String? {
        if let bootstrapErrorMessage {
            return bootstrapErrorMessage
        }
        if case .failed(let error) = connectionState {
            return error.userMessage
        }
        return nil
    }

    var bootstrapStep: BootstrapOnboardingStep {
        if case .connecting = connectionState {
            return .checking
        }
        if isBootstrapBusy {
            return .checking
        }
        guard let bootstrapStatus else {
            return bootstrapErrorMessage == nil ? .checking : .manualFallback
        }
        if bootstrapStatus.configValid == false {
            return .manualFallback
        }
        if bootstrapStatus.needsLocalSetup {
            return .createLocalSetup
        }
        if bootstrapStatus.needsDaemonStart {
            return .startDaemon
        }
        if bootstrapStatus.canGrantNativeSession {
            return .grantLocalAccess
        }
        return .manualFallback
    }

    // MARK: - Store Accessors

    func dashboardStore() -> DashboardStore { stores.dashboard() }
    func commandCenterStore() -> CommandCenterStore { stores.commandCenter() }
    func runsStore() -> RunsStore { stores.runs() }
    func jobsStore() -> JobsStore { stores.jobs() }
    func receiptsStore() -> ReceiptsStore { stores.receipts() }
    func interventionsStore() -> InterventionsStore { stores.interventions() }
    func approvalsStore() -> ApprovalsStore { stores.approvals() }
    func connectionsStore() -> ConnectionsStore { stores.connections() }
    func usageSecurityStore() -> UsageSecurityStore { stores.usageSecurity() }
    func usageStore() -> UsageStore { stores.usage() }
    func setupStore() -> SetupStore { stores.setup() }
    func brainStore() -> BrainStore { stores.brain() }
    func memoryStore() -> MemoryStore { stores.memory() }
    func agentProfilesStore() -> AgentProfilesStore { stores.agentProfiles() }
    func instructionPreviewStore() -> InstructionPreviewStore { stores.instructionPreview() }
    func automationStore() -> AutomationStore { stores.automations() }
    func homeStore() -> HomeStore { stores.home() }
    func emailStore() -> EmailStore { stores.email() }
    func calendarStore() -> CalendarStore { stores.calendar() }
    func todosStore() -> TodosStore { stores.todos() }
    func peopleStore() -> PeopleStore { stores.people() }
    func filesStore() -> FilesStore { stores.files() }
    func financeStore() -> FinanceStore { stores.finance() }
    func medicalStore() -> MedicalStore { stores.medical() }
    func telegramStore() -> TelegramStore { stores.telegram() }

    // MARK: - Cross-Navigation

    func navigate(to route: AppRoute) {
        navigation.navigate(to: route)
    }

    func navigateToRun(id: String) {
        runsStore().selectedRunId = id
        navigate(to: .runs)
    }

    func navigateToConnection(id: String?) {
        if let id {
            connectionsStore().selectedId = id
        }
        navigate(to: .connections)
    }

    func navigateToHome() { navigate(to: .home) }
    func navigateToSetup() { navigate(to: .setup) }
    func navigateToBrain() { navigate(to: .brain) }
    func navigateToAutomations() { navigate(to: .automations) }
    func navigateToMail() { navigate(to: .email) }
    func navigateToCalendar() { navigate(to: .calendar) }
    func navigateToTodos() { navigate(to: .todos) }
    func navigateToPeople() { navigate(to: .people) }
    func navigateToFiles() { navigate(to: .files) }
    func navigateToFinance() { navigate(to: .finance) }
    func navigateToMedical() { navigate(to: .medical) }
    func navigateToInstructions() { navigate(to: .instructionPreview) }
    func navigateToAgentProfiles() { navigate(to: .agentProfiles) }
    func navigateToTelegram() { navigate(to: .telegram) }

    func navigateToMemory(id: String? = nil, preferredMode: MemoryStore.ViewMode? = nil) {
        let store = memoryStore()
        if let preferredMode {
            store.viewMode = preferredMode
        }
        if let id {
            store.selectedMemoryId = id
        }
        navigate(to: .memory)
    }

    // MARK: - Connection

    func connect(baseURL: String, token: String) async {
        bootstrapErrorMessage = nil
        _ = await connect(
            baseURL: baseURL,
            credential: .bearerToken(token),
            persistedCredential: .bearerToken
        )
    }

    func createLocalSetup() async {
        await performBootstrapOperation {
            let status = try await self.localBootstrapService.ensureLocalSetup()
            self.applyBootstrapStatus(status)
        }
    }

    func startLocalDaemon() async {
        await performBootstrapOperation {
            let status = try await self.localBootstrapService.startDaemon()
            self.applyBootstrapStatus(status)
        }
    }

    func grantLocalAccess() async {
        await performBootstrapOperation {
            let session = try await self.localBootstrapService.issueNativeSession()
            let connected = await self.connect(
                baseURL: session.baseURL,
                credential: .nativeSession(session.sessionToken),
                persistedCredential: .nativeSession
            )
            if connected == false {
                await self.refreshBootstrapStatus()
            }
        }
    }

    func disconnect() {
        let revokeClient = client
        let shouldRevokeNativeSession = activeCredentialKind == .nativeSession

        stopSSE()
        client = nil
        stores.reset()
        workspace.clear()
        connectionState = .disconnected
        badgeCounts = BadgeCounts()
        activeCredentialKind = nil
        try? credentialStore.deleteAllCredentials()
        Task { [weak self] in
            if shouldRevokeNativeSession {
                _ = try? await revokeClient?.revokeCurrentNativeAppSession()
            }
            await self?.refreshBootstrapStatus()
        }
    }

    func restoreSession() async {
        if let nativeSession = try? credentialStore.retrieveNativeSession(),
           nativeSession.isEmpty == false {
            let restored = await connect(
                baseURL: baseURL,
                credential: .nativeSession(nativeSession),
                persistedCredential: .nativeSession,
                persistOnSuccess: false,
                suppressFailureState: true
            )
            if restored {
                return
            }
            try? credentialStore.deleteNativeSession()
        }

        if let bearerToken = try? credentialStore.retrieveBearerToken(),
           bearerToken.isEmpty == false {
            let restored = await connect(
                baseURL: baseURL,
                credential: .bearerToken(bearerToken),
                persistedCredential: .bearerToken,
                persistOnSuccess: false,
                suppressFailureState: true
            )
            if restored {
                return
            }
            try? credentialStore.deleteBearerToken()
        }

        connectionState = .disconnected
        await refreshBootstrapStatus()
    }

    func refreshBootstrapStatus() async {
        guard isConnected == false else { return }
        do {
            let status = try await localBootstrapService.status()
            applyBootstrapStatus(status)
        } catch {
            bootstrapStatus = nil
            bootstrapErrorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    @discardableResult
    private func connect(
        baseURL: String,
        credential: ControlAPICredential,
        persistedCredential: StoredCredentialKind,
        persistOnSuccess: Bool = true,
        suppressFailureState: Bool = false
    ) async -> Bool {
        self.baseURL = baseURL
        bootstrapErrorMessage = nil
        connectionState = .connecting
        stopSSE()

        let newClient = ControlAPIClient(baseURL: baseURL, credential: credential)

        do {
            _ = try await newClient.health()
            _ = try await newClient.status()
            if persistOnSuccess {
                try persistCredential(credential, as: persistedCredential)
            }
            activeCredentialKind = persistedCredential
            client = newClient
            await refreshWorkspaces(using: newClient)
            connectionState = .connected
            bootstrapStatus = nil
            if sseEnabled { startSSE() }
            return true
        } catch let error as APIError {
            client = nil
            activeCredentialKind = nil
            connectionState = suppressFailureState ? .disconnected : .failed(error)
            return false
        } catch {
            client = nil
            activeCredentialKind = nil
            connectionState = suppressFailureState ? .disconnected : .failed(.transportUnavailable)
            return false
        }
    }

    private func persistCredential(_ credential: ControlAPICredential, as kind: StoredCredentialKind) throws {
        switch (credential, kind) {
        case (.bearerToken(let token), .bearerToken):
            try credentialStore.saveBearerToken(token)
            try? credentialStore.deleteNativeSession()
        case (.nativeSession(let sessionToken), .nativeSession):
            try credentialStore.saveNativeSession(sessionToken)
            try? credentialStore.deleteBearerToken()
        default:
            break
        }
    }

    private func performBootstrapOperation(_ operation: @escaping () async throws -> Void) async {
        guard isBootstrapBusy == false else { return }
        isBootstrapBusy = true
        bootstrapErrorMessage = nil
        defer { isBootstrapBusy = false }

        do {
            try await operation()
        } catch {
            bootstrapErrorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func applyBootstrapStatus(_ status: LocalBootstrapStatus) {
        bootstrapStatus = status
        bootstrapErrorMessage = status.error
        baseURL = status.baseURL
    }

    private func refreshWorkspaces(using client: ControlAPIClient) async {
        let service = SystemService(client: client)
        do {
            let loadedWorkspaces = try await service.loadWorkspaces()
            workspace.replaceWorkspaces(loadedWorkspaces)
        } catch {
            workspace.clear()
        }
    }

    // MARK: - SSE

    private func startSSE() {
        guard let client else { return }
        stopSSE()

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

private enum StorageKey {
    static let baseURL = "baseURL"
    static let sseEnabled = "sseEnabled"
    static let pollIntervalSeconds = "pollIntervalSeconds"
}
