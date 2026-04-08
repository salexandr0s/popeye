import Foundation
import Testing

@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("Connections Store")
struct ConnectionsStoreTests {
    @Test("Load selects the first connection and hydrates diagnostics and resource rules")
    func loadHydratesSelectionContext() async {
        let store = ConnectionsStore(dependencies: .stub())

        await store.load()
        await waitUntil {
            store.selectedId == "conn-gh-1" && store.detailPhase == .idle && store.diagnostics != nil
        }

        #expect(store.loadPhase == .loaded)
        #expect(store.selectedConnection?.id == "conn-gh-1")
        #expect(store.selectedResourceRules.count == 1)
        #expect(store.diagnostics?.connectionId == "conn-gh-1")
    }

    @Test("OAuth connect opens the browser, polls to completion, and invalidates connections")
    func oauthConnectFlow() async {
        let pollCounter = PollCounter()
        let loadCounter = PollCounter()
        let openedURLs = LockedArrayBox<URL>()
        let invalidations = LockedArrayBox<InvalidationSignal>()

        let store = ConnectionsStore(
            dependencies: .stub(
                loadConnections: {
                    let _ = await loadCounter.next()
                    return [sampleConnection()]
                },
                startOAuthConnection: { providerKind, connectionId, mode, syncIntervalSeconds in
                    #expect(providerKind == "github")
                    #expect(connectionId == nil)
                    #expect(mode == "read_only")
                    #expect(syncIntervalSeconds == 900)
                    return OAuthSessionDTO(
                        id: "oauth-gh-1",
                        providerKind: "github",
                        domain: "github",
                        status: "pending",
                        authorizationUrl: "https://github.com/login/oauth/authorize?state=test",
                        redirectUri: "http://127.0.0.1:3210/v1/connections/oauth/callback",
                        connectionId: nil,
                        accountId: nil,
                        error: nil,
                        createdAt: "2026-04-08T09:00:00Z",
                        expiresAt: "2026-04-08T09:05:00Z",
                        completedAt: nil
                    )
                },
                loadOAuthSession: { _ in
                    let count = await pollCounter.next()
                    return OAuthSessionDTO(
                        id: "oauth-gh-1",
                        providerKind: "github",
                        domain: "github",
                        status: count > 1 ? "completed" : "pending",
                        authorizationUrl: "https://github.com/login/oauth/authorize?state=test",
                        redirectUri: "http://127.0.0.1:3210/v1/connections/oauth/callback",
                        connectionId: "conn-gh-1",
                        accountId: "gh-account-1",
                        error: nil,
                        createdAt: "2026-04-08T09:00:00Z",
                        expiresAt: "2026-04-08T09:05:00Z",
                        completedAt: count > 1 ? "2026-04-08T09:01:00Z" : nil
                    )
                },
                openURL: { url in
                    openedURLs.append(url)
                    return true
                },
                sleep: { _ in },
                emitInvalidation: { signal in
                    invalidations.append(signal)
                }
            )
        )

        await store.load()
        await store.connect(.github)

        let recordedURLs = openedURLs.get()
        let recordedInvalidations = invalidations.get()

        #expect(recordedURLs.count == 1)
        #expect(recordedURLs.first?.absoluteString.contains("github.com") == true)
        #expect(store.mutationState == .succeeded("GitHub connected"))
        #expect(recordedInvalidations.contains(.connections))
        let reloadCount = await loadCounter.peek()
        #expect(reloadCount >= 2)
    }

    @Test("Toggle connection enabled updates the selected connection after reload")
    func toggleConnectionEnabled() async {
        let box = ConnectionBox(initial: sampleConnection(enabled: true))
        let store = ConnectionsStore(
            dependencies: .stub(
                loadConnections: { [box] in [await box.get()] },
                updateConnection: { [box] id, input in
                    #expect(id == "conn-gh-1")
                    #expect(input.enabled == false)
                    let updated = sampleConnection(enabled: false)
                    await box.set(updated)
                    return updated
                }
            )
        )

        await store.load()
        await waitUntil { store.detailPhase == .idle }
        await store.toggleSelectedConnectionEnabled()

        #expect(store.selectedConnection?.enabled == false)
        #expect(store.mutationState == .succeeded("Connection disabled"))
    }

    @Test("Add and remove resource rules refreshes inspector state")
    func addAndRemoveRule() async {
        let rules = ResourceRulesBox(initial: [])
        let store = ConnectionsStore(
            dependencies: .stub(
                loadResourceRules: { _ in await rules.get() },
                addResourceRule: { _, input in
                    let next = ConnectionResourceRuleDTO(
                        resourceType: input.resourceType,
                        resourceId: input.resourceId,
                        displayName: input.displayName,
                        writeAllowed: input.writeAllowed,
                        createdAt: "2026-04-08T09:00:00Z",
                        updatedAt: "2026-04-08T09:00:00Z"
                    )
                    await rules.set([next])
                    return sampleConnection(resourceRules: [next])
                },
                removeResourceRule: { _, input in
                    #expect(input.resourceId == "nb/popeye")
                    await rules.set([])
                    return sampleConnection(resourceRules: [])
                }
            )
        )

        await store.load()
        await waitUntil { store.detailPhase == .idle }

        store.ruleDraft.resourceType = .repo
        store.ruleDraft.resourceId = "nb/popeye"
        store.ruleDraft.displayName = "Popeye"
        store.ruleDraft.writeAllowed = true

        await store.addRule()
        await waitUntil { store.selectedResourceRules.count == 1 }

        #expect(store.selectedResourceRules.first?.resourceId == "nb/popeye")
        #expect(store.mutationState == .succeeded("Resource rule added"))

        if let rule = store.selectedResourceRules.first {
            await store.removeRule(rule)
        }
        await waitUntil { store.selectedResourceRules.isEmpty }

        #expect(store.selectedResourceRules.isEmpty)
        #expect(store.mutationState == .succeeded("Resource rule removed"))
    }

    @Test("Reconnect action refreshes diagnostics after remediation")
    func reconnectRefreshesDiagnostics() async {
        let diagnostics = DiagnosticsBox(initial: sampleDiagnostics(summary: "Needs reconnect"))
        let store = ConnectionsStore(
            dependencies: .stub(
                loadDiagnostics: { _ in await diagnostics.get() },
                reconnect: { connectionId, action in
                    #expect(connectionId == "conn-gh-1")
                    #expect(action == "reconnect")
                    let next = sampleDiagnostics(summary: "Connection healthy again", remediation: nil)
                    await diagnostics.set(next)
                    return sampleConnection(remediation: nil)
                }
            )
        )

        await store.load()
        await waitUntil { store.detailPhase == .idle && store.diagnostics != nil }
        await store.reconnectSelectedConnection()
        await waitUntil { store.diagnostics?.humanSummary == "Connection healthy again" }

        #expect(store.mutationState == .succeeded("Reconnect requested"))
    }

    private func waitUntil(
        _ predicate: @escaping @MainActor () -> Bool,
        attempts: Int = 20
    ) async {
        for _ in 0..<attempts {
            if predicate() { return }
            await Task.yield()
        }
    }
}

extension ConnectionsStore.Dependencies {
    fileprivate static func stub(
        loadConnections: @escaping @Sendable () async throws -> [ConnectionDTO] = { [sampleConnection()] },
        loadOAuthProviders: @escaping @Sendable () async throws -> [OAuthProviderAvailabilityDTO] = {
            [
                OAuthProviderAvailabilityDTO(
                    providerKind: "github",
                    domain: "github",
                    status: "ready",
                    details: "GitHub OAuth is configured."
                ),
                OAuthProviderAvailabilityDTO(
                    providerKind: "gmail",
                    domain: "email",
                    status: "ready",
                    details: "Gmail OAuth is configured."
                ),
                OAuthProviderAvailabilityDTO(
                    providerKind: "google_calendar",
                    domain: "calendar",
                    status: "ready",
                    details: "Calendar OAuth is configured."
                ),
                OAuthProviderAvailabilityDTO(
                    providerKind: "google_tasks",
                    domain: "todos",
                    status: "ready",
                    details: "Tasks OAuth is configured."
                ),
            ]
        },
        startOAuthConnection: @escaping @Sendable (_ providerKind: String, _ connectionId: String?, _ mode: String, _ syncIntervalSeconds: Int) async throws -> OAuthSessionDTO = { providerKind, connectionId, _, _ in
            OAuthSessionDTO(
                id: "oauth-\(providerKind)-1",
                providerKind: providerKind,
                domain: providerKind == "github" ? "github" : "email",
                status: "pending",
                authorizationUrl: "https://example.com/oauth",
                redirectUri: "http://127.0.0.1:3210/v1/connections/oauth/callback",
                connectionId: connectionId,
                accountId: nil,
                error: nil,
                createdAt: "2026-04-08T09:00:00Z",
                expiresAt: "2026-04-08T09:05:00Z",
                completedAt: nil
            )
        },
        loadOAuthSession: @escaping @Sendable (_ sessionId: String) async throws -> OAuthSessionDTO = { _ in
            OAuthSessionDTO(
                id: "oauth-github-1",
                providerKind: "github",
                domain: "github",
                status: "completed",
                authorizationUrl: "https://example.com/oauth",
                redirectUri: "http://127.0.0.1:3210/v1/connections/oauth/callback",
                connectionId: "conn-gh-1",
                accountId: "gh-account-1",
                error: nil,
                createdAt: "2026-04-08T09:00:00Z",
                expiresAt: "2026-04-08T09:05:00Z",
                completedAt: "2026-04-08T09:01:00Z"
            )
        },
        updateConnection: @escaping @Sendable (_ id: String, _ input: ConnectionUpdateInput) async throws -> ConnectionDTO = { _, input in
            sampleConnection(enabled: input.enabled ?? true)
        },
        loadResourceRules: @escaping @Sendable (_ connectionId: String) async throws -> [ConnectionResourceRuleDTO] = { _ in
            [sampleRule()]
        },
        addResourceRule: @escaping @Sendable (_ connectionId: String, _ input: ConnectionResourceRuleCreateInput) async throws -> ConnectionDTO = { _, input in
            sampleConnection(resourceRules: [
                ConnectionResourceRuleDTO(
                    resourceType: input.resourceType,
                    resourceId: input.resourceId,
                    displayName: input.displayName,
                    writeAllowed: input.writeAllowed,
                    createdAt: "2026-04-08T09:00:00Z",
                    updatedAt: "2026-04-08T09:00:00Z"
                )
            ])
        },
        removeResourceRule: @escaping @Sendable (_ connectionId: String, _ input: ConnectionResourceRuleDeleteInput) async throws -> ConnectionDTO = { _, _ in
            sampleConnection(resourceRules: [])
        },
        loadDiagnostics: @escaping @Sendable (_ connectionId: String) async throws -> ConnectionDiagnosticsDTO = { _ in
            sampleDiagnostics()
        },
        reconnect: @escaping @Sendable (_ connectionId: String, _ action: String) async throws -> ConnectionDTO = { _, _ in
            sampleConnection(remediation: nil)
        },
        loadEmailAccounts: @escaping @Sendable () async throws -> [EmailAccountDTO] = { [] },
        syncEmailAccount: @escaping @Sendable (_ accountId: String) async throws -> EmailSyncResultDTO = { accountId in
            EmailSyncResultDTO(accountId: accountId, synced: 1, updated: 1, errors: [])
        },
        loadCalendarAccounts: @escaping @Sendable () async throws -> [CalendarAccountDTO] = { [] },
        syncCalendarAccount: @escaping @Sendable (_ accountId: String) async throws -> CalendarSyncResultDTO = { accountId in
            CalendarSyncResultDTO(accountId: accountId, eventsSynced: 1, eventsUpdated: 1, errors: [])
        },
        loadTodoAccounts: @escaping @Sendable () async throws -> [TodoAccountDTO] = { [] },
        syncTodoAccount: @escaping @Sendable (_ accountId: String) async throws -> TodoSyncResultDTO = { accountId in
            TodoSyncResultDTO(accountId: accountId, todosSynced: 1, todosUpdated: 1, errors: [])
        },
        loadGithubAccounts: @escaping @Sendable () async throws -> [GithubAccountDTO] = {
            [
                GithubAccountDTO(
                    id: "gh-account-1",
                    connectionId: "conn-gh-1",
                    githubUsername: "octocat",
                    displayName: "Octo Cat",
                    syncCursorSince: nil,
                    lastSyncAt: "2026-04-08T09:00:00Z",
                    repoCount: 1,
                    createdAt: "2026-04-08T08:00:00Z",
                    updatedAt: "2026-04-08T09:00:00Z"
                )
            ]
        },
        syncGithubAccount: @escaping @Sendable (_ accountId: String) async throws -> GithubSyncResultDTO = { accountId in
            GithubSyncResultDTO(
                accountId: accountId,
                reposSynced: 1,
                prsSynced: 1,
                issuesSynced: 1,
                notificationsSynced: 1,
                errors: []
            )
        },
        openURL: @escaping @Sendable (_ url: URL) -> Bool = { _ in true },
        sleep: @escaping @Sendable (_ duration: Duration) async -> Void = { _ in },
        emitInvalidation: @escaping @Sendable (_ signal: InvalidationSignal) -> Void = { _ in },
        oauthPollInterval: Duration = .seconds(2),
        oauthTimeout: Duration = .seconds(120)
    ) -> Self {
        Self(
            loadConnections: loadConnections,
            loadOAuthProviders: loadOAuthProviders,
            startOAuthConnection: startOAuthConnection,
            loadOAuthSession: loadOAuthSession,
            updateConnection: updateConnection,
            loadResourceRules: loadResourceRules,
            addResourceRule: addResourceRule,
            removeResourceRule: removeResourceRule,
            loadDiagnostics: loadDiagnostics,
            reconnect: reconnect,
            loadEmailAccounts: loadEmailAccounts,
            syncEmailAccount: syncEmailAccount,
            loadCalendarAccounts: loadCalendarAccounts,
            syncCalendarAccount: syncCalendarAccount,
            loadTodoAccounts: loadTodoAccounts,
            syncTodoAccount: syncTodoAccount,
            loadGithubAccounts: loadGithubAccounts,
            syncGithubAccount: syncGithubAccount,
            openURL: openURL,
            sleep: sleep,
            emitInvalidation: emitInvalidation,
            oauthPollInterval: oauthPollInterval,
            oauthTimeout: oauthTimeout
        )
    }
}

private func sampleConnection(
    enabled: Bool = true,
    resourceRules: [ConnectionResourceRuleDTO]? = nil,
    remediation: ConnectionRemediationDTO? = ConnectionRemediationDTO(
        action: "reconnect",
        message: "Reconnect the GitHub bridge.",
        updatedAt: "2026-04-08T09:00:00Z"
    )
) -> ConnectionDTO {
    ConnectionDTO(
        id: "conn-gh-1",
        domain: "github",
        providerKind: "github",
        label: "GitHub",
        mode: "read_only",
        enabled: enabled,
        resourceRules: resourceRules,
        lastSyncAt: "2026-04-08T09:00:00Z",
        lastSyncStatus: "success",
        policy: ConnectionPolicyDTO(
            status: "ready",
            secretStatus: "configured",
            mutatingRequiresApproval: true
        ),
        health: ConnectionHealthDTO(
            status: remediation == nil ? "healthy" : "degraded",
            authState: "configured",
            checkedAt: "2026-04-08T09:00:00Z",
            lastError: remediation == nil ? nil : "Sync stalled.",
            remediation: remediation
        ),
        sync: ConnectionSyncDTO(
            lastAttemptAt: "2026-04-08T09:00:00Z",
            lastSuccessAt: "2026-04-08T08:55:00Z",
            status: remediation == nil ? "success" : "partial",
            lagSummary: remediation == nil ? "0s" : "5m behind"
        ),
        createdAt: "2026-04-08T08:00:00Z",
        updatedAt: "2026-04-08T09:00:00Z"
    )
}

private func sampleRule() -> ConnectionResourceRuleDTO {
    ConnectionResourceRuleDTO(
        resourceType: "repo",
        resourceId: "nb/popeye",
        displayName: "Popeye",
        writeAllowed: true,
        createdAt: "2026-04-08T09:00:00Z",
        updatedAt: "2026-04-08T09:00:00Z"
    )
}

private func sampleDiagnostics(
    summary: String = "GitHub is connected but requires operator attention.",
    remediation: ConnectionRemediationDTO? = ConnectionRemediationDTO(
        action: "reconnect",
        message: "Reconnect the GitHub bridge.",
        updatedAt: "2026-04-08T09:00:00Z"
    )
) -> ConnectionDiagnosticsDTO {
    ConnectionDiagnosticsDTO(
        connectionId: "conn-gh-1",
        label: "GitHub",
        providerKind: "github",
        domain: "github",
        enabled: true,
        health: ConnectionHealthDTO(
            status: remediation == nil ? "healthy" : "degraded",
            authState: "configured",
            checkedAt: "2026-04-08T09:00:00Z",
            lastError: remediation == nil ? nil : "Sync stalled.",
            diagnostics: [
                ConnectionDiagnosticDTO(
                    code: "sync_lag",
                    severity: remediation == nil ? "info" : "warn",
                    message: remediation == nil ? "Sync is current." : "Sync lag exceeded threshold."
                )
            ],
            remediation: remediation
        ),
        sync: ConnectionSyncDTO(
            lastAttemptAt: "2026-04-08T09:00:00Z",
            lastSuccessAt: remediation == nil ? "2026-04-08T09:00:00Z" : "2026-04-08T08:55:00Z",
            status: remediation == nil ? "success" : "partial",
            lagSummary: remediation == nil ? "0s" : "5m behind"
        ),
        policy: ConnectionPolicyDTO(
            status: "ready",
            secretStatus: "configured",
            mutatingRequiresApproval: true
        ),
        remediation: remediation,
        humanSummary: summary
    )
}

private actor PollCounter {
    private var value = 0

    func next() -> Int {
        value += 1
        return value
    }

    func peek() -> Int {
        value
    }
}

private final class LockedArrayBox<Element>: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Element] = []

    func append(_ value: Element) {
        lock.lock()
        values.append(value)
        lock.unlock()
    }

    func get() -> [Element] {
        lock.lock()
        let snapshot = values
        lock.unlock()
        return snapshot
    }
}

private actor ConnectionBox {
    private var value: ConnectionDTO

    init(initial: ConnectionDTO) {
        self.value = initial
    }

    func get() -> ConnectionDTO { value }
    func set(_ next: ConnectionDTO) { value = next }
}

private actor ResourceRulesBox {
    private var value: [ConnectionResourceRuleDTO]

    init(initial: [ConnectionResourceRuleDTO]) {
        self.value = initial
    }

    func get() -> [ConnectionResourceRuleDTO] { value }
    func set(_ next: [ConnectionResourceRuleDTO]) { value = next }
}

private actor DiagnosticsBox {
    private var value: ConnectionDiagnosticsDTO

    init(initial: ConnectionDiagnosticsDTO) {
        self.value = initial
    }

    func get() -> ConnectionDiagnosticsDTO { value }
    func set(_ next: ConnectionDiagnosticsDTO) { value = next }
}
