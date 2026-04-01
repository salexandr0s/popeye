import Testing
import Foundation
@testable import PopeyeAPI

@Suite("SystemService")
struct ServiceTests {
    @Test("DashboardSnapshot fields match DTOs")
    func snapshotFields() {
        let status = DaemonStatusDTO(
            ok: true, runningJobs: 2, queuedJobs: 1,
            openInterventions: 0, activeLeases: 2,
            engineKind: "pi", schedulerRunning: true,
            startedAt: "2026-03-22T10:00:00Z", lastShutdownAt: nil
        )
        let scheduler = SchedulerStatusDTO(
            running: true, activeLeases: 2, activeRuns: 1,
            nextHeartbeatDueAt: "2026-03-22T10:05:00Z"
        )
        let capabilities = EngineCapabilitiesDTO(
            engineKind: "pi", persistentSessionSupport: true,
            resumeBySessionRefSupport: true, hostToolMode: "native",
            compactionEventSupport: true, cancellationMode: "rpc_abort",
            acceptedRequestMetadata: [], warnings: []
        )
        let usage = UsageSummaryDTO(
            runs: 42, tokensIn: 150000, tokensOut: 80000,
            estimatedCostUsd: 3.45
        )
        let audit = SecurityAuditDTO(findings: [])

        let snapshot = DashboardSnapshot(
            status: status, scheduler: scheduler,
            capabilities: capabilities, usage: usage,
            securityAudit: audit
        )

        #expect(snapshot.status.runningJobs == 2)
        #expect(snapshot.scheduler.running == true)
        #expect(snapshot.capabilities.engineKind == "pi")
        #expect(snapshot.usage.estimatedCostUsd == 3.45)
        #expect(snapshot.securityAudit?.findings.isEmpty == true)
    }

    @Test("DashboardSnapshot with nil audit")
    func snapshotNilAudit() {
        let snapshot = DashboardSnapshot(
            status: DaemonStatusDTO(
                ok: true, runningJobs: 0, queuedJobs: 0,
                openInterventions: 0, activeLeases: 0,
                engineKind: "fake", schedulerRunning: false,
                startedAt: "2026-03-22T10:00:00Z", lastShutdownAt: nil
            ),
            scheduler: SchedulerStatusDTO(
                running: false, activeLeases: 0, activeRuns: 0,
                nextHeartbeatDueAt: nil
            ),
            capabilities: EngineCapabilitiesDTO(
                engineKind: "fake", persistentSessionSupport: false,
                resumeBySessionRefSupport: false, hostToolMode: "none",
                compactionEventSupport: false, cancellationMode: "none",
                acceptedRequestMetadata: [], warnings: []
            ),
            usage: UsageSummaryDTO(
                runs: 0, tokensIn: 0, tokensOut: 0,
                estimatedCostUsd: 0
            ),
            securityAudit: nil
        )

        #expect(snapshot.securityAudit == nil)
        #expect(snapshot.status.ok == true)
    }

    @Test("Identity endpoints encode workspace query")
    func identityEndpoints() {
        let identities = Endpoint.identities(workspaceId: "default")
        let defaultIdentity = Endpoint.defaultIdentity(workspaceId: "default")

        #expect(identities.path == "/v1/identities")
        #expect(identities.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
        #expect(defaultIdentity.path == "/v1/identities/default")
        #expect(defaultIdentity.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    }

    @Test("OAuth and secret endpoints use the expected paths")
    func setupActionEndpoints() {
        let oauthStart = Endpoint.startOAuthConnection
        let oauthSession = Endpoint.oauthConnectionSession(id: "oauth-session-001")
        let secretStore = Endpoint.storeSecret

        #expect(oauthStart.path == "/v1/connections/oauth/start")
        #expect(oauthStart.method == .post)
        #expect(oauthSession.path == "/v1/connections/oauth/sessions/oauth-session-001")
        #expect(secretStore.path == "/v1/secrets")
        #expect(secretStore.method == .post)
    }

    @Test("Workspace and Telegram control endpoints use the expected paths")
    func workspaceAndTelegramEndpoints() {
        let workspaces = Endpoint.workspaces
        let telegramConfig = Endpoint.telegramConfig
        let saveTelegramConfig = Endpoint.saveTelegramConfig
        let applyTelegramConfig = Endpoint.applyTelegramConfig
        let restartDaemon = Endpoint.restartDaemon
        let mutationReceipts = Endpoint.mutationReceipts(component: "telegram", limit: 6)

        #expect(workspaces.path == "/v1/workspaces")
        #expect(telegramConfig.path == "/v1/config/telegram")
        #expect(saveTelegramConfig.method == .post)
        #expect(applyTelegramConfig.path == "/v1/daemon/components/telegram/apply")
        #expect(restartDaemon.path == "/v1/daemon/restart")
        #expect(mutationReceipts.path == "/v1/governance/mutation-receipts")
        #expect(mutationReceipts.queryItems.contains(URLQueryItem(name: "component", value: "telegram")))
        #expect(mutationReceipts.queryItems.contains(URLQueryItem(name: "limit", value: "6")))
    }

    @Test("Memory list endpoint encodes optional filters")
    func memoryListEndpoint() {
        let endpoint = Endpoint.memories(
            type: "semantic",
            scope: "default",
            workspaceId: "default",
            projectId: "proj-1",
            includeGlobal: true,
            limit: 200
        )

        #expect(endpoint.path == "/v1/memory")
        #expect(endpoint.queryItems.contains(URLQueryItem(name: "type", value: "semantic")))
        #expect(endpoint.queryItems.contains(URLQueryItem(name: "scope", value: "default")))
        #expect(endpoint.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
        #expect(endpoint.queryItems.contains(URLQueryItem(name: "projectId", value: "proj-1")))
        #expect(endpoint.queryItems.contains(URLQueryItem(name: "includeGlobal", value: "true")))
        #expect(endpoint.queryItems.contains(URLQueryItem(name: "limit", value: "200")))
    }

    @Test("Memory search endpoint encodes workspace-aware filters once")
    func memorySearchEndpoint() {
        let endpoint = Endpoint.memorySearch(
            query: "triage",
            limit: 50,
            scope: "default",
            workspaceId: "workspace-2",
            types: "semantic",
            domains: "coding"
        )

        #expect(endpoint.path == "/v1/memory/search")
        #expect(endpoint.queryItems.filter { $0.name == "workspaceId" }.count == 1)
        #expect(endpoint.queryItems.contains(URLQueryItem(name: "workspaceId", value: "workspace-2")))
        #expect(endpoint.queryItems.contains(URLQueryItem(name: "limit", value: "50")))
    }
}
