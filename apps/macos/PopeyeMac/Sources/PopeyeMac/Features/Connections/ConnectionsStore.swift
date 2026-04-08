import AppKit
import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class ConnectionsStore {
    enum BusyKey: Equatable {
        case connect(String)
        case toggle(String)
        case sync(String)
        case addRule
        case removeRule(String)
        case reconnect(String)
    }

    enum SupportedOAuthProvider: String, CaseIterable, Identifiable {
        case gmail
        case googleCalendar = "google_calendar"
        case googleTasks = "google_tasks"
        case github

        var id: String { rawValue }

        var title: String {
            switch self {
            case .gmail: "Gmail"
            case .googleCalendar: "Google Calendar"
            case .googleTasks: "Google Tasks"
            case .github: "GitHub"
            }
        }

        var mode: String {
            switch self {
            case .googleTasks: "read_write"
            default: "read_only"
            }
        }
    }

    enum ResourceRuleType: String, CaseIterable, Identifiable {
        case resource
        case mailbox
        case calendar
        case repo
        case project

        var id: String { rawValue }
    }

    struct ResourceRuleDraft {
        var resourceType: ResourceRuleType = .resource
        var resourceId = ""
        var displayName = ""
        var writeAllowed = false

        var isValid: Bool {
            !resourceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    struct Dependencies: Sendable {
        var loadConnections: @Sendable () async throws -> [ConnectionDTO]
        var loadOAuthProviders: @Sendable () async throws -> [OAuthProviderAvailabilityDTO]
        var startOAuthConnection: @Sendable (_ providerKind: String, _ connectionId: String?, _ mode: String, _ syncIntervalSeconds: Int) async throws -> OAuthSessionDTO
        var loadOAuthSession: @Sendable (_ sessionId: String) async throws -> OAuthSessionDTO
        var updateConnection: @Sendable (_ id: String, _ input: ConnectionUpdateInput) async throws -> ConnectionDTO
        var loadResourceRules: @Sendable (_ connectionId: String) async throws -> [ConnectionResourceRuleDTO]
        var addResourceRule: @Sendable (_ connectionId: String, _ input: ConnectionResourceRuleCreateInput) async throws -> ConnectionDTO
        var removeResourceRule: @Sendable (_ connectionId: String, _ input: ConnectionResourceRuleDeleteInput) async throws -> ConnectionDTO
        var loadDiagnostics: @Sendable (_ connectionId: String) async throws -> ConnectionDiagnosticsDTO
        var reconnect: @Sendable (_ connectionId: String, _ action: String) async throws -> ConnectionDTO
        var loadEmailAccounts: @Sendable () async throws -> [EmailAccountDTO]
        var syncEmailAccount: @Sendable (_ accountId: String) async throws -> EmailSyncResultDTO
        var loadCalendarAccounts: @Sendable () async throws -> [CalendarAccountDTO]
        var syncCalendarAccount: @Sendable (_ accountId: String) async throws -> CalendarSyncResultDTO
        var loadTodoAccounts: @Sendable () async throws -> [TodoAccountDTO]
        var syncTodoAccount: @Sendable (_ accountId: String) async throws -> TodoSyncResultDTO
        var loadGithubAccounts: @Sendable () async throws -> [GithubAccountDTO]
        var syncGithubAccount: @Sendable (_ accountId: String) async throws -> GithubSyncResultDTO
        var openURL: @Sendable (_ url: URL) -> Bool
        var sleep: @Sendable (_ duration: Duration) async -> Void
        var emitInvalidation: @Sendable (_ signal: InvalidationSignal) -> Void
        var oauthPollInterval: Duration
        var oauthTimeout: Duration

        static func live(client: ControlAPIClient) -> Dependencies {
            let connectionsService = ConnectionsService(client: client)
            let emailService = EmailDomainService(client: client)
            let calendarService = CalendarDomainService(client: client)
            let todosService = TodosDomainService(client: client)
            let githubService = GithubService(client: client)

            return Dependencies(
                loadConnections: { try await connectionsService.loadConnections() },
                loadOAuthProviders: { try await connectionsService.loadOAuthProviders() },
                startOAuthConnection: { providerKind, connectionId, mode, syncIntervalSeconds in
                    try await connectionsService.startOAuthConnection(
                        providerKind: providerKind,
                        connectionId: connectionId,
                        mode: mode,
                        syncIntervalSeconds: syncIntervalSeconds
                    )
                },
                loadOAuthSession: { sessionId in
                    try await connectionsService.loadOAuthSession(id: sessionId)
                },
                updateConnection: { id, input in
                    try await connectionsService.updateConnection(id: id, input: input)
                },
                loadResourceRules: { connectionId in
                    try await connectionsService.loadResourceRules(connectionId: connectionId)
                },
                addResourceRule: { connectionId, input in
                    try await connectionsService.addResourceRule(connectionId: connectionId, input: input)
                },
                removeResourceRule: { connectionId, input in
                    try await connectionsService.removeResourceRule(connectionId: connectionId, input: input)
                },
                loadDiagnostics: { connectionId in
                    try await connectionsService.loadDiagnostics(connectionId: connectionId)
                },
                reconnect: { connectionId, action in
                    try await connectionsService.reconnect(connectionId: connectionId, action: action)
                },
                loadEmailAccounts: { try await emailService.loadAccounts() },
                syncEmailAccount: { accountId in try await emailService.sync(accountId: accountId) },
                loadCalendarAccounts: { try await calendarService.loadAccounts() },
                syncCalendarAccount: { accountId in try await calendarService.sync(accountId: accountId) },
                loadTodoAccounts: { try await todosService.loadAccounts() },
                syncTodoAccount: { accountId in try await todosService.sync(accountId: accountId) },
                loadGithubAccounts: { try await githubService.loadAccounts() },
                syncGithubAccount: { accountId in try await githubService.sync(accountId: accountId) },
                openURL: { url in NSWorkspace.shared.open(url) },
                sleep: { duration in try? await Task.sleep(for: duration) },
                emitInvalidation: { signal in
                    NotificationCenter.default.post(name: .popeyeInvalidation, object: signal)
                },
                oauthPollInterval: .seconds(2),
                oauthTimeout: .seconds(120)
            )
        }
    }

    var connections: [ConnectionDTO] = []
    var oauthProviders: [OAuthProviderAvailabilityDTO] = []
    var resourceRules: [ConnectionResourceRuleDTO] = []
    var diagnostics: ConnectionDiagnosticsDTO?
    var selectedId: String? {
        didSet {
            guard oldValue != selectedId else { return }
            resetSelectionContext()
            Task { await loadSelectedConnectionContext() }
        }
    }

    var loadPhase: ScreenLoadPhase = .idle
    var detailPhase: ScreenOperationPhase = .idle
    var busyKey: BusyKey?
    var ruleDraft = ResourceRuleDraft()

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let dependencies: Dependencies
    private var accountIDByConnectionID: [String: String] = [:]

    init(client: ControlAPIClient) {
        self.dependencies = .live(client: client)
    }

    init(dependencies: Dependencies) {
        self.dependencies = dependencies
    }

    var error: APIError? { loadPhase.error }
    var detailError: APIError? { detailPhase.error }

    var selectedConnection: ConnectionDTO? {
        guard let selectedId else { return nil }
        return connections.first { $0.id == selectedId }
    }

    var selectedResourceRules: [ConnectionResourceRuleDTO] {
        if resourceRules.isEmpty {
            return selectedConnection?.resourceRules ?? []
        }
        return resourceRules
    }

    var healthyCount: Int {
        connections.count(where: { $0.health?.status == "healthy" })
    }

    var degradedCount: Int {
        connections.count(where: { $0.health?.status == "degraded" })
    }

    var errorCount: Int {
        connections.count(where: { $0.health?.status == "error" || $0.health?.status == "reauth_required" })
    }

    var blockedProviders: [OAuthProviderAvailabilityDTO] {
        oauthProviders.filter { !$0.isReady }
    }

    var canAddRule: Bool {
        selectedConnection != nil && ruleDraft.isValid && !isBusy(.addRule)
    }

    func load() async {
        loadPhase = .loading

        do {
            async let connectionsTask = dependencies.loadConnections()
            async let providersTask = dependencies.loadOAuthProviders()
            async let emailAccountsTask = dependencies.loadEmailAccounts()
            async let calendarAccountsTask = dependencies.loadCalendarAccounts()
            async let todoAccountsTask = dependencies.loadTodoAccounts()
            async let githubAccountsTask = dependencies.loadGithubAccounts()

            let (
                loadedConnections,
                loadedProviders,
                emailAccounts,
                calendarAccounts,
                todoAccounts,
                githubAccounts
            ) = try await (
                connectionsTask,
                providersTask,
                emailAccountsTask,
                calendarAccountsTask,
                todoAccountsTask,
                githubAccountsTask
            )

            connections = loadedConnections
            oauthProviders = loadedProviders
            accountIDByConnectionID = buildAccountMap(
                emailAccounts: emailAccounts,
                calendarAccounts: calendarAccounts,
                todoAccounts: todoAccounts,
                githubAccounts: githubAccounts
            )

            let selectionChanged = synchronizeSelection()
            loadPhase = loadedConnections.isEmpty ? .empty : .loaded

            if !selectionChanged {
                await loadSelectedConnectionContext()
            }
        } catch {
            loadPhase = .failed(APIError.from(error))
        }
    }

    func loadSelectedConnectionContext() async {
        guard let selectedConnection else {
            resourceRules = []
            diagnostics = nil
            detailPhase = .idle
            return
        }

        let selectedConnectionID = selectedConnection.id
        let fallbackRules = selectedConnection.resourceRules ?? []
        detailPhase = .loading

        do {
            async let rulesTask = dependencies.loadResourceRules(selectedConnectionID)
            async let diagnosticsTask = dependencies.loadDiagnostics(selectedConnectionID)
            let (loadedRules, loadedDiagnostics) = try await (rulesTask, diagnosticsTask)

            guard selectedId == selectedConnectionID else { return }
            resourceRules = loadedRules
            diagnostics = loadedDiagnostics
            detailPhase = .idle
        } catch {
            guard selectedId == selectedConnectionID else { return }
            resourceRules = fallbackRules
            diagnostics = nil
            detailPhase = .failed(APIError.from(error))
        }
    }

    func connect(_ provider: SupportedOAuthProvider, connectionId: String? = nil) async {
        if let availability = oauthProviders.first(where: { $0.providerKind == provider.rawValue }),
           availability.isReady == false
        {
            mutations.state = .failed(availability.details)
            return
        }

        await runMutation(
            key: .connect(provider.rawValue),
            successMessage: connectionId == nil ? "\(provider.title) connected" : "\(provider.title) reconnected",
            fallbackError: "Connection flow failed."
        ) { [self] in
            let session = try await self.dependencies.startOAuthConnection(
                provider.rawValue,
                connectionId,
                provider.mode,
                900
            )

            guard let url = URL(string: session.authorizationUrl) else {
                throw APIError.apiFailure(
                    statusCode: -1,
                    message: SetupActionError.invalidAuthorizationURL.localizedDescription
                )
            }

            guard self.dependencies.openURL(url) else {
                throw APIError.apiFailure(
                    statusCode: -1,
                    message: SetupActionError.browserLaunchFailed.localizedDescription
                )
            }

            try await self.waitForOAuthCompletion(sessionID: session.id)
            self.dependencies.emitInvalidation(.connections)
        }
    }

    func toggleSelectedConnectionEnabled() async {
        guard let selectedConnection else { return }
        let nextEnabled = !selectedConnection.enabled

        await runMutation(
            key: .toggle(selectedConnection.id),
            successMessage: nextEnabled ? "Connection enabled" : "Connection disabled",
            fallbackError: "Couldn’t update this connection."
        ) { [self] in
            _ = try await self.dependencies.updateConnection(
                selectedConnection.id,
                ConnectionUpdateInput(enabled: nextEnabled)
            )
            self.dependencies.emitInvalidation(.connections)
        }
    }

    func syncSelectedConnection() async {
        guard let selectedConnection else { return }
        guard let accountID = accountIDByConnectionID[selectedConnection.id] else {
            mutations.state = .failed("No registered account is available for this connection.")
            return
        }

        let successMessage: String
        switch selectedConnection.domain {
        case "email":
            successMessage = "Mail synced"
        case "calendar":
            successMessage = "Calendar synced"
        case "github":
            successMessage = "GitHub synced"
        case "todos":
            successMessage = "Todos synced"
        default:
            mutations.state = .failed("Manual sync is not available for \(selectedConnection.domain) connections.")
            return
        }

        await runMutation(
            key: .sync(selectedConnection.id),
            successMessage: successMessage,
            fallbackError: "Couldn’t sync this connection."
        ) { [self] in
            switch selectedConnection.domain {
            case "email":
                _ = try await self.dependencies.syncEmailAccount(accountID)
            case "calendar":
                _ = try await self.dependencies.syncCalendarAccount(accountID)
            case "github":
                _ = try await self.dependencies.syncGithubAccount(accountID)
            case "todos":
                _ = try await self.dependencies.syncTodoAccount(accountID)
            default:
                break
            }

            self.dependencies.emitInvalidation(.connections)
            self.dependencies.emitInvalidation(.general)
        }
    }

    func addRule() async {
        guard let selectedConnection else { return }
        guard ruleDraft.isValid else {
            mutations.state = .failed("Enter a resource ID and display name before adding a rule.")
            return
        }

        let input = ConnectionResourceRuleCreateInput(
            resourceType: ruleDraft.resourceType.rawValue,
            resourceId: ruleDraft.resourceId.trimmingCharacters(in: .whitespacesAndNewlines),
            displayName: ruleDraft.displayName.trimmingCharacters(in: .whitespacesAndNewlines),
            writeAllowed: ruleDraft.writeAllowed
        )

        await runMutation(
            key: .addRule,
            successMessage: "Resource rule added",
            fallbackError: "Couldn’t add this resource rule."
        ) { [self] in
            _ = try await self.dependencies.addResourceRule(selectedConnection.id, input)
            self.ruleDraft = ResourceRuleDraft()
            self.dependencies.emitInvalidation(.connections)
        }
    }

    func removeRule(_ rule: ConnectionResourceRuleDTO) async {
        guard let selectedConnection else { return }
        let input = ConnectionResourceRuleDeleteInput(
            resourceType: rule.resourceType,
            resourceId: rule.resourceId
        )

        await runMutation(
            key: .removeRule(rule.id),
            successMessage: "Resource rule removed",
            fallbackError: "Couldn’t remove this resource rule."
        ) { [self] in
            _ = try await self.dependencies.removeResourceRule(selectedConnection.id, input)
            self.dependencies.emitInvalidation(.connections)
        }
    }

    func reconnectSelectedConnection() async {
        guard let selectedConnection else { return }

        let remediationAction = diagnostics?.remediation?.action
            ?? diagnostics?.health.remediation?.action
            ?? selectedConnection.health?.remediation?.action

        guard let remediationAction else {
            mutations.state = .failed("This connection does not currently expose a reconnect action.")
            return
        }

        if let provider = oauthProvider(for: selectedConnection),
           remediationAction == "reauthorize" || remediationAction == "scope_fix"
        {
            await connect(provider, connectionId: selectedConnection.id)
            return
        }

        await runMutation(
            key: .reconnect(selectedConnection.id),
            successMessage: "Reconnect requested",
            fallbackError: "Couldn’t reconnect this connection."
        ) { [self] in
            _ = try await self.dependencies.reconnect(selectedConnection.id, remediationAction)
            self.dependencies.emitInvalidation(.connections)
        }
    }

    func dismissMutation() {
        mutations.dismiss()
    }

    func isBusy(_ key: BusyKey) -> Bool {
        busyKey == key
    }

    func oauthProvider(for connection: ConnectionDTO) -> SupportedOAuthProvider? {
        SupportedOAuthProvider(rawValue: connection.providerKind)
    }

    func oauthAvailability(for provider: SupportedOAuthProvider) -> OAuthProviderAvailabilityDTO? {
        oauthProviders.first(where: { $0.providerKind == provider.rawValue })
    }

    func browserReconnectLabel(for connection: ConnectionDTO) -> String {
        switch diagnostics?.remediation?.action ?? connection.health?.remediation?.action {
        case "reauthorize":
            return "Reauthorize in Browser"
        case "scope_fix":
            return "Repair Scopes in Browser"
        default:
            return "Reconnect in Browser"
        }
    }

    func supportsManualSync(for connection: ConnectionDTO) -> Bool {
        switch connection.domain {
        case "email", "calendar", "github", "todos":
            return accountIDByConnectionID[connection.id] != nil
        default:
            return false
        }
    }

    private func synchronizeSelection() -> Bool {
        let previousSelection = selectedId

        guard !connections.isEmpty else {
            selectedId = nil
            return previousSelection != nil
        }

        if let selectedId,
           connections.contains(where: { $0.id == selectedId })
        {
            return false
        }

        self.selectedId = connections.first?.id
        return previousSelection != self.selectedId
    }

    private func resetSelectionContext() {
        resourceRules = selectedConnection?.resourceRules ?? []
        diagnostics = nil
        detailPhase = selectedId == nil ? .idle : .loading
        ruleDraft = ResourceRuleDraft()
    }

    private func buildAccountMap(
        emailAccounts: [EmailAccountDTO],
        calendarAccounts: [CalendarAccountDTO],
        todoAccounts: [TodoAccountDTO],
        githubAccounts: [GithubAccountDTO]
    ) -> [String: String] {
        var result: [String: String] = [:]

        for account in emailAccounts {
            result[account.connectionId] = account.id
        }

        for account in calendarAccounts {
            result[account.connectionId] = account.id
        }

        for account in todoAccounts {
            if let connectionId = account.connectionId {
                result[connectionId] = account.id
            }
        }

        for account in githubAccounts {
            result[account.connectionId] = account.id
        }

        return result
    }

    private func runMutation(
        key: BusyKey,
        successMessage: String,
        fallbackError: String,
        action: @escaping @MainActor () async throws -> Void
    ) async {
        guard busyKey == nil else { return }
        busyKey = key
        await mutations.execute(
            action: action,
            successMessage: successMessage,
            fallbackError: fallbackError,
            reload: { [weak self] in
                await self?.load()
            }
        )
        busyKey = nil
    }

    private func waitForOAuthCompletion(sessionID: String) async throws {
        let deadline = ContinuousClock.now + dependencies.oauthTimeout

        while ContinuousClock.now < deadline {
            let session = try await dependencies.loadOAuthSession(sessionID)

            switch session.status {
            case "completed":
                return
            case "failed":
                throw APIError.apiFailure(
                    statusCode: -1,
                    message: SetupActionError.oauthFailed(
                        session.error ?? "The provider authorization failed."
                    ).localizedDescription
                )
            case "expired":
                throw APIError.apiFailure(
                    statusCode: -1,
                    message: SetupActionError.oauthExpired.localizedDescription
                )
            default:
                await dependencies.sleep(dependencies.oauthPollInterval)
            }
        }

        throw APIError.apiFailure(
            statusCode: -1,
            message: SetupActionError.oauthTimedOut.localizedDescription
        )
    }
}
