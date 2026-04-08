import Foundation

public struct Endpoint: Sendable {
    public let path: String
    public let method: HTTPMethod
    public let queryItems: [URLQueryItem]

    public init(path: String, method: HTTPMethod = .get, queryItems: [URLQueryItem] = []) {
        self.path = path
        self.method = method
        self.queryItems = queryItems
    }
}

public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case delete = "DELETE"
}

// MARK: - System Endpoints

public extension Endpoint {
    static let health = Endpoint(path: "/v1/health")
    static let status = Endpoint(path: "/v1/status")
    static func homeSummary(workspaceId: String) -> Endpoint {
        Endpoint(path: "/v1/home/summary", queryItems: [
            URLQueryItem(name: "workspaceId", value: workspaceId),
        ])
    }
    static let schedulerStatus = Endpoint(path: "/v1/daemon/scheduler")
    static let engineCapabilities = Endpoint(path: "/v1/engine/capabilities")
    static let usageSummary = Endpoint(path: "/v1/usage/summary")
    static let csrfToken = Endpoint(path: "/v1/security/csrf-token")
    static let currentNativeAppSession = Endpoint(path: "/v1/auth/native-app-session/current", method: .delete)
    static let securityAudit = Endpoint(path: "/v1/security/audit")
    static let daemonState = Endpoint(path: "/v1/daemon/state")
    static let workspaces = Endpoint(path: "/v1/workspaces")
    static func vaults(domain: String? = nil) -> Endpoint {
        let items = domain.map { [URLQueryItem(name: "domain", value: $0)] } ?? []
        return Endpoint(path: "/v1/vaults", queryItems: items)
    }

    static func automations(workspaceId: String? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let workspaceId { items.append(URLQueryItem(name: "workspaceId", value: workspaceId)) }
        return Endpoint(path: "/v1/automations", queryItems: items)
    }
    static func automation(id: String) -> Endpoint { Endpoint(path: "/v1/automations/\(id)") }
    static func updateAutomation(id: String) -> Endpoint { Endpoint(path: "/v1/automations/\(id)", method: .patch) }
    static func runAutomationNow(id: String) -> Endpoint { Endpoint(path: "/v1/automations/\(id)/run-now", method: .post) }
    static func pauseAutomation(id: String) -> Endpoint { Endpoint(path: "/v1/automations/\(id)/pause", method: .post) }
    static func resumeAutomation(id: String) -> Endpoint { Endpoint(path: "/v1/automations/\(id)/resume", method: .post) }
    static let eventStream = Endpoint(path: "/v1/events/stream")
}

// MARK: - Execution Endpoints

public extension Endpoint {
    static let tasks = Endpoint(path: "/v1/tasks")
    static func task(id: String) -> Endpoint { Endpoint(path: "/v1/tasks/\(id)") }

    static let jobs = Endpoint(path: "/v1/jobs")
    static func job(id: String) -> Endpoint { Endpoint(path: "/v1/jobs/\(id)") }
    static func jobLease(id: String) -> Endpoint { Endpoint(path: "/v1/jobs/\(id)/lease") }
    static func pauseJob(id: String) -> Endpoint { Endpoint(path: "/v1/jobs/\(id)/pause", method: .post) }
    static func resumeJob(id: String) -> Endpoint { Endpoint(path: "/v1/jobs/\(id)/resume", method: .post) }
    static func enqueueJob(id: String) -> Endpoint { Endpoint(path: "/v1/jobs/\(id)/enqueue", method: .post) }

    static let runs = Endpoint(path: "/v1/runs")
    static func run(id: String) -> Endpoint { Endpoint(path: "/v1/runs/\(id)") }
    static func runEnvelope(id: String) -> Endpoint { Endpoint(path: "/v1/runs/\(id)/envelope") }
    static func runReceipt(id: String) -> Endpoint { Endpoint(path: "/v1/runs/\(id)/receipt") }
    static func runReply(id: String) -> Endpoint { Endpoint(path: "/v1/runs/\(id)/reply") }
    static func runEvents(id: String) -> Endpoint { Endpoint(path: "/v1/runs/\(id)/events") }
    static func retryRun(id: String) -> Endpoint { Endpoint(path: "/v1/runs/\(id)/retry", method: .post) }
    static func cancelRun(id: String) -> Endpoint { Endpoint(path: "/v1/runs/\(id)/cancel", method: .post) }

    static let receipts = Endpoint(path: "/v1/receipts")
    static func receipt(id: String) -> Endpoint { Endpoint(path: "/v1/receipts/\(id)") }
}

// MARK: - Governance Endpoints

public extension Endpoint {
    static let interventions = Endpoint(path: "/v1/interventions")
    static func resolveIntervention(id: String) -> Endpoint {
        Endpoint(path: "/v1/interventions/\(id)/resolve", method: .post)
    }

    static let approvals = Endpoint(path: "/v1/approvals")
    static let createApproval = Endpoint(path: "/v1/approvals", method: .post)
    static func approval(id: String) -> Endpoint { Endpoint(path: "/v1/approvals/\(id)") }
    static func resolveApproval(id: String) -> Endpoint {
        Endpoint(path: "/v1/approvals/\(id)/resolve", method: .post)
    }

    static func standingApprovals(
        status: String? = nil,
        domain: String? = nil,
        actionKind: String? = nil
    ) -> Endpoint {
        var items: [URLQueryItem] = []
        if let status { items.append(URLQueryItem(name: "status", value: status)) }
        if let domain { items.append(URLQueryItem(name: "domain", value: domain)) }
        if let actionKind { items.append(URLQueryItem(name: "actionKind", value: actionKind)) }
        return Endpoint(path: "/v1/policies/standing-approvals", queryItems: items)
    }

    static let createStandingApproval = Endpoint(path: "/v1/policies/standing-approvals", method: .post)

    static func revokeStandingApproval(id: String) -> Endpoint {
        Endpoint(path: "/v1/policies/standing-approvals/\(id)/revoke", method: .post)
    }

    static func automationGrants(
        status: String? = nil,
        domain: String? = nil,
        actionKind: String? = nil
    ) -> Endpoint {
        var items: [URLQueryItem] = []
        if let status { items.append(URLQueryItem(name: "status", value: status)) }
        if let domain { items.append(URLQueryItem(name: "domain", value: domain)) }
        if let actionKind { items.append(URLQueryItem(name: "actionKind", value: actionKind)) }
        return Endpoint(path: "/v1/policies/automation-grants", queryItems: items)
    }

    static let createAutomationGrant = Endpoint(path: "/v1/policies/automation-grants", method: .post)

    static func revokeAutomationGrant(id: String) -> Endpoint {
        Endpoint(path: "/v1/policies/automation-grants/\(id)/revoke", method: .post)
    }

    static let securityPolicy = Endpoint(path: "/v1/security/policy")

    static func vault(id: String) -> Endpoint {
        Endpoint(path: "/v1/vaults/\(id)")
    }

    static func openVault(id: String) -> Endpoint {
        Endpoint(path: "/v1/vaults/\(id)/open", method: .post)
    }

    static func closeVault(id: String) -> Endpoint {
        Endpoint(path: "/v1/vaults/\(id)/close", method: .post)
    }
}

// MARK: - Connections

public extension Endpoint {
    static let connections = Endpoint(path: "/v1/connections")
    static let storeSecret = Endpoint(path: "/v1/secrets", method: .post)
    static let providerAuthConfig = Endpoint(path: "/v1/config/provider-auth")
    static let syncEmail = Endpoint(path: "/v1/email/sync", method: .post)
    static let syncCalendar = Endpoint(path: "/v1/calendar/sync", method: .post)
    static let syncTodos = Endpoint(path: "/v1/todos/sync", method: .post)

    static let oauthConnectionProviders = Endpoint(path: "/v1/connections/oauth/providers")
    static let startOAuthConnection = Endpoint(path: "/v1/connections/oauth/start", method: .post)
    static func updateProviderAuthConfig(provider: String) -> Endpoint {
        Endpoint(path: "/v1/config/provider-auth/\(provider)", method: .post)
    }
    static func updateConnection(id: String) -> Endpoint {
        Endpoint(path: "/v1/connections/\(id)", method: .patch)
    }
    static func connectionResourceRules(id: String) -> Endpoint {
        Endpoint(path: "/v1/connections/\(id)/resource-rules")
    }
    static func addConnectionResourceRule(id: String) -> Endpoint {
        Endpoint(path: "/v1/connections/\(id)/resource-rules", method: .post)
    }
    static func deleteConnectionResourceRule(id: String) -> Endpoint {
        Endpoint(path: "/v1/connections/\(id)/resource-rules", method: .delete)
    }
    static func connectionDiagnostics(id: String) -> Endpoint {
        Endpoint(path: "/v1/connections/\(id)/diagnostics")
    }
    static func reconnectConnection(id: String) -> Endpoint {
        Endpoint(path: "/v1/connections/\(id)/reconnect", method: .post)
    }

    static func oauthConnectionSession(id: String) -> Endpoint {
        Endpoint(path: "/v1/connections/oauth/sessions/\(id)")
    }
}

// MARK: - Identity Endpoints

public extension Endpoint {
    static func identities(workspaceId: String) -> Endpoint {
        Endpoint(path: "/v1/identities", queryItems: [
            URLQueryItem(name: "workspaceId", value: workspaceId),
        ])
    }

    static func defaultIdentity(workspaceId: String) -> Endpoint {
        Endpoint(path: "/v1/identities/default", queryItems: [
            URLQueryItem(name: "workspaceId", value: workspaceId),
        ])
    }
}

// MARK: - Memory Endpoints

public extension Endpoint {
    static let memories = Endpoint(path: "/v1/memory")

    static func memories(
        type: String? = nil,
        scope: String? = nil,
        workspaceId: String? = nil,
        projectId: String? = nil,
        includeGlobal: Bool? = nil,
        limit: Int? = nil
    ) -> Endpoint {
        var items: [URLQueryItem] = []
        if let type { items.append(URLQueryItem(name: "type", value: type)) }
        if let scope { items.append(URLQueryItem(name: "scope", value: scope)) }
        if let workspaceId { items.append(URLQueryItem(name: "workspaceId", value: workspaceId)) }
        if let projectId { items.append(URLQueryItem(name: "projectId", value: projectId)) }
        if let includeGlobal { items.append(URLQueryItem(name: "includeGlobal", value: includeGlobal ? "true" : "false")) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/memory", queryItems: items)
    }

    static func memorySearch(query: String, limit: Int = 20, scope: String? = nil, workspaceId: String? = nil, types: String? = nil, domains: String? = nil, full: Bool = false) -> Endpoint {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if full { items.append(URLQueryItem(name: "full", value: "true")) }
        if let scope { items.append(URLQueryItem(name: "scope", value: scope)) }
        if let workspaceId { items.append(URLQueryItem(name: "workspaceId", value: workspaceId)) }
        if let types { items.append(URLQueryItem(name: "types", value: types)) }
        if let domains { items.append(URLQueryItem(name: "domains", value: domains)) }
        return Endpoint(path: "/v1/memory/search", queryItems: items)
    }

    static func memory(id: String) -> Endpoint { Endpoint(path: "/v1/memory/\(id)") }
    static func memoryDescribe(id: String) -> Endpoint { Endpoint(path: "/v1/memory/\(id)/describe") }
    static func memoryExpand(id: String) -> Endpoint { Endpoint(path: "/v1/memory/\(id)/expand") }
    static func memoryHistory(id: String) -> Endpoint { Endpoint(path: "/v1/memory/\(id)/history") }
    static func memoryPin(id: String) -> Endpoint { Endpoint(path: "/v1/memory/\(id)/pin", method: .post) }
    static func memoryForget(id: String) -> Endpoint { Endpoint(path: "/v1/memory/\(id)/forget", method: .post) }
    static func memoryPromotePropose(id: String) -> Endpoint { Endpoint(path: "/v1/memory/\(id)/promote/propose", method: .post) }
    static func memoryPromoteExecute(id: String) -> Endpoint { Endpoint(path: "/v1/memory/\(id)/promote/execute", method: .post) }

    static let memoryAudit = Endpoint(path: "/v1/memory/audit")
    static let memoryIntegrity = Endpoint(path: "/v1/memory/integrity")
    static let memoryMaintenance = Endpoint(path: "/v1/memory/maintenance", method: .post)
}

// MARK: - Agent Profiles

public extension Endpoint {
    static let agentProfiles = Endpoint(path: "/v1/agent-profiles")
    static func agentProfile(id: String) -> Endpoint { Endpoint(path: "/v1/agent-profiles/\(id)") }
}

// MARK: - Instruction Previews

public extension Endpoint {
    static func instructionPreview(scope: String) -> Endpoint {
        Endpoint(path: "/v1/instruction-previews/\(scope)")
    }

    static func curatedDocuments(workspaceId: String) -> Endpoint {
        Endpoint(path: "/v1/curated-documents", queryItems: [
            URLQueryItem(name: "workspaceId", value: workspaceId),
        ])
    }

    static func curatedDocument(id: String) -> Endpoint {
        Endpoint(path: "/v1/curated-documents/\(id)")
    }

    static func proposeCuratedDocumentSave(id: String) -> Endpoint {
        Endpoint(path: "/v1/curated-documents/\(id)/propose-save", method: .post)
    }

    static func applyCuratedDocumentSave(id: String) -> Endpoint {
        Endpoint(path: "/v1/curated-documents/\(id)/apply-save", method: .post)
    }
}

// MARK: - Knowledge Endpoints

public extension Endpoint {
    static func knowledgeSources(workspaceId: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/sources", queryItems: [
            URLQueryItem(name: "workspaceId", value: workspaceId),
        ])
    }

    static func knowledgeSource(id: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/sources/\(id)")
    }

    static func knowledgeSourceSnapshots(id: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/sources/\(id)/snapshots")
    }

    static func reingestKnowledgeSource(id: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/sources/\(id)/reingest", method: .post)
    }

    static let importKnowledgeSource = Endpoint(path: "/v1/knowledge/import", method: .post)

    static let knowledgeConverters = Endpoint(path: "/v1/knowledge/converters")

    static func knowledgeBetaRuns(workspaceId: String, limit: Int? = nil) -> Endpoint {
        var items: [URLQueryItem] = [URLQueryItem(name: "workspaceId", value: workspaceId)]
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/knowledge/beta-runs", queryItems: items)
    }

    static func knowledgeBetaRun(id: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/beta-runs/\(id)")
    }

    static func knowledgeDocuments(workspaceId: String, kind: String? = nil, query: String? = nil) -> Endpoint {
        var items: [URLQueryItem] = [URLQueryItem(name: "workspaceId", value: workspaceId)]
        if let kind { items.append(URLQueryItem(name: "kind", value: kind)) }
        if let query, !query.isEmpty { items.append(URLQueryItem(name: "q", value: query)) }
        return Endpoint(path: "/v1/knowledge/documents", queryItems: items)
    }

    static func knowledgeDocument(id: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/documents/\(id)")
    }

    static func knowledgeDocumentRevisions(id: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/documents/\(id)/revisions")
    }

    static func proposeKnowledgeDocumentRevision(id: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/documents/\(id)/revisions", method: .post)
    }

    static func applyKnowledgeRevision(id: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/revisions/\(id)/apply", method: .post)
    }

    static func rejectKnowledgeRevision(id: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/revisions/\(id)/reject", method: .post)
    }

    static func knowledgeNeighborhood(id: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/documents/\(id)/neighborhood")
    }

    static let createKnowledgeLink = Endpoint(path: "/v1/knowledge/links", method: .post)

    static func knowledgeCompileJobs(workspaceId: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/compile-jobs", queryItems: [
            URLQueryItem(name: "workspaceId", value: workspaceId),
        ])
    }

    static func knowledgeAudit(workspaceId: String) -> Endpoint {
        Endpoint(path: "/v1/knowledge/audit", queryItems: [
            URLQueryItem(name: "workspaceId", value: workspaceId),
        ])
    }
}


// MARK: - Domain Endpoints

public extension Endpoint {
    static let githubAccounts = Endpoint(path: "/v1/github/accounts")
    static func githubRepos(accountId: String? = nil, limit: Int? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let accountId { items.append(URLQueryItem(name: "accountId", value: accountId)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/github/repos", queryItems: items)
    }
    static func githubPullRequests(
        accountId: String? = nil,
        state: String? = nil,
        limit: Int? = nil
    ) -> Endpoint {
        var items: [URLQueryItem] = []
        if let accountId { items.append(URLQueryItem(name: "accountId", value: accountId)) }
        if let state { items.append(URLQueryItem(name: "state", value: state)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/github/prs", queryItems: items)
    }
    static func githubPullRequest(id: String) -> Endpoint { Endpoint(path: "/v1/github/prs/\(id)") }
    static func githubIssues(
        accountId: String? = nil,
        state: String? = nil,
        assigned: Bool? = nil,
        limit: Int? = nil
    ) -> Endpoint {
        var items: [URLQueryItem] = []
        if let accountId { items.append(URLQueryItem(name: "accountId", value: accountId)) }
        if let state { items.append(URLQueryItem(name: "state", value: state)) }
        if let assigned { items.append(URLQueryItem(name: "assigned", value: assigned ? "true" : "false")) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/github/issues", queryItems: items)
    }
    static func githubIssue(id: String) -> Endpoint { Endpoint(path: "/v1/github/issues/\(id)") }
    static func githubNotifications(accountId: String? = nil, limit: Int? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let accountId { items.append(URLQueryItem(name: "accountId", value: accountId)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/github/notifications", queryItems: items)
    }
    static func githubDigest(accountId: String? = nil) -> Endpoint {
        let items = accountId.map { [URLQueryItem(name: "accountId", value: $0)] } ?? []
        return Endpoint(path: "/v1/github/digest", queryItems: items)
    }
    static func githubSearch(
        query: String,
        accountId: String? = nil,
        entityType: String? = nil,
        limit: Int? = nil
    ) -> Endpoint {
        var items: [URLQueryItem] = [URLQueryItem(name: "query", value: query)]
        if let accountId { items.append(URLQueryItem(name: "accountId", value: accountId)) }
        if let entityType { items.append(URLQueryItem(name: "entityType", value: entityType)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/github/search", queryItems: items)
    }
    static let syncGithub = Endpoint(path: "/v1/github/sync", method: .post)
    static let createGithubComment = Endpoint(path: "/v1/github/comments", method: .post)
    static let markGithubNotificationRead = Endpoint(
        path: "/v1/github/notifications/mark-read", method: .post)

    static func playbooks(
        q: String? = nil,
        scope: String? = nil,
        workspaceId: String? = nil,
        projectId: String? = nil,
        status: String? = nil,
        limit: Int? = nil,
        offset: Int? = nil
    ) -> Endpoint {
        var items: [URLQueryItem] = []
        if let q, !q.isEmpty { items.append(URLQueryItem(name: "q", value: q)) }
        if let scope { items.append(URLQueryItem(name: "scope", value: scope)) }
        if let workspaceId { items.append(URLQueryItem(name: "workspaceId", value: workspaceId)) }
        if let projectId { items.append(URLQueryItem(name: "projectId", value: projectId)) }
        if let status { items.append(URLQueryItem(name: "status", value: status)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let offset { items.append(URLQueryItem(name: "offset", value: String(offset))) }
        return Endpoint(path: "/v1/playbooks", queryItems: items)
    }
    static func playbook(id: String) -> Endpoint { Endpoint(path: "/v1/playbooks/\(id)") }
    static let playbookStaleCandidates = Endpoint(path: "/v1/playbooks/stale-candidates")
    static func playbookRevisions(id: String) -> Endpoint {
        Endpoint(path: "/v1/playbooks/\(id)/revisions")
    }
    static func playbookUsage(id: String, limit: Int? = nil, offset: Int? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let offset { items.append(URLQueryItem(name: "offset", value: String(offset))) }
        return Endpoint(path: "/v1/playbooks/\(id)/usage", queryItems: items)
    }
    static func playbookProposals(
        q: String? = nil,
        status: String? = nil,
        kind: String? = nil,
        scope: String? = nil,
        sourceRunId: String? = nil,
        targetRecordId: String? = nil,
        sort: String? = nil,
        limit: Int? = nil,
        offset: Int? = nil
    ) -> Endpoint {
        var items: [URLQueryItem] = []
        if let q, !q.isEmpty { items.append(URLQueryItem(name: "q", value: q)) }
        if let status { items.append(URLQueryItem(name: "status", value: status)) }
        if let kind { items.append(URLQueryItem(name: "kind", value: kind)) }
        if let scope { items.append(URLQueryItem(name: "scope", value: scope)) }
        if let sourceRunId { items.append(URLQueryItem(name: "sourceRunId", value: sourceRunId)) }
        if let targetRecordId {
            items.append(URLQueryItem(name: "targetRecordId", value: targetRecordId))
        }
        if let sort { items.append(URLQueryItem(name: "sort", value: sort)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let offset { items.append(URLQueryItem(name: "offset", value: String(offset))) }
        return Endpoint(path: "/v1/playbook-proposals", queryItems: items)
    }
    static func playbookProposal(id: String) -> Endpoint {
        Endpoint(path: "/v1/playbook-proposals/\(id)")
    }
    static func reviewPlaybookProposal(id: String) -> Endpoint {
        Endpoint(path: "/v1/playbook-proposals/\(id)/review", method: .post)
    }
    static func submitPlaybookProposalForReview(id: String) -> Endpoint {
        Endpoint(path: "/v1/playbook-proposals/\(id)/submit-review", method: .post)
    }
    static func applyPlaybookProposal(id: String) -> Endpoint {
        Endpoint(path: "/v1/playbook-proposals/\(id)/apply", method: .post)
    }
    static func activatePlaybook(id: String) -> Endpoint {
        Endpoint(path: "/v1/playbooks/\(id)/activate", method: .post)
    }
    static func retirePlaybook(id: String) -> Endpoint {
        Endpoint(path: "/v1/playbooks/\(id)/retire", method: .post)
    }

    static let emailAccounts = Endpoint(path: "/v1/email/accounts")
    static func emailThreads(accountId: String? = nil, limit: Int? = nil, unreadOnly: Bool? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let accountId { items.append(URLQueryItem(name: "accountId", value: accountId)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let unreadOnly { items.append(URLQueryItem(name: "unreadOnly", value: unreadOnly ? "true" : "false")) }
        return Endpoint(path: "/v1/email/threads", queryItems: items)
    }
    static func emailThread(id: String) -> Endpoint { Endpoint(path: "/v1/email/threads/\(id)") }
    static func emailDigest(accountId: String? = nil) -> Endpoint {
        let items = accountId.map { [URLQueryItem(name: "accountId", value: $0)] } ?? []
        return Endpoint(path: "/v1/email/digest", queryItems: items)
    }

    static let calendarAccounts = Endpoint(path: "/v1/calendar/accounts")
    static func calendarEvents(accountId: String? = nil, dateFrom: String? = nil, dateTo: String? = nil, limit: Int? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let accountId { items.append(URLQueryItem(name: "accountId", value: accountId)) }
        if let dateFrom { items.append(URLQueryItem(name: "dateFrom", value: dateFrom)) }
        if let dateTo { items.append(URLQueryItem(name: "dateTo", value: dateTo)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/calendar/events", queryItems: items)
    }
    static func calendarEvent(id: String) -> Endpoint { Endpoint(path: "/v1/calendar/events/\(id)") }
    static func calendarDigest(accountId: String? = nil) -> Endpoint {
        let items = accountId.map { [URLQueryItem(name: "accountId", value: $0)] } ?? []
        return Endpoint(path: "/v1/calendar/digest", queryItems: items)
    }

    static let todoAccounts = Endpoint(path: "/v1/todos/accounts")
    static func todoItems(accountId: String? = nil, project: String? = nil, limit: Int? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let accountId { items.append(URLQueryItem(name: "accountId", value: accountId)) }
        if let project { items.append(URLQueryItem(name: "project", value: project)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/todos/items", queryItems: items)
    }
    static func todoItem(id: String) -> Endpoint { Endpoint(path: "/v1/todos/items/\(id)") }
    static func todoProjects(accountId: String) -> Endpoint {
        Endpoint(path: "/v1/todos/projects", queryItems: [URLQueryItem(name: "accountId", value: accountId)])
    }
    static func todoDigest(accountId: String? = nil) -> Endpoint {
        let items = accountId.map { [URLQueryItem(name: "accountId", value: $0)] } ?? []
        return Endpoint(path: "/v1/todos/digest", queryItems: items)
    }

    static let people = Endpoint(path: "/v1/people")
    static func peopleSearch(query: String, limit: Int = 20) -> Endpoint {
        Endpoint(path: "/v1/people/search", queryItems: [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ])
    }
    static func person(id: String) -> Endpoint { Endpoint(path: "/v1/people/\(id)") }
    static func personMergeEvents(id: String) -> Endpoint { Endpoint(path: "/v1/people/\(id)/merge-events") }
    static let personMergeSuggestions = Endpoint(path: "/v1/people/merge-suggestions")
    static func personActivity(id: String) -> Endpoint { Endpoint(path: "/v1/people/\(id)/activity") }
    static let mergePeople = Endpoint(path: "/v1/people/merge", method: .post)
    static func splitPerson(id: String) -> Endpoint { Endpoint(path: "/v1/people/\(id)/split", method: .post) }
    static let attachPersonIdentity = Endpoint(path: "/v1/people/identities/attach", method: .post)
    static func detachPersonIdentity(id: String) -> Endpoint {
        Endpoint(path: "/v1/people/identities/\(id)/detach", method: .post)
    }

    static func fileRoots(workspaceId: String? = nil) -> Endpoint {
        let items = workspaceId.map { [URLQueryItem(name: "workspaceId", value: $0)] } ?? []
        return Endpoint(path: "/v1/files/roots", queryItems: items)
    }
    static let createFileRoot = Endpoint(path: "/v1/files/roots", method: .post)
    static func fileRoot(id: String) -> Endpoint { Endpoint(path: "/v1/files/roots/\(id)") }
    static func updateFileRoot(id: String) -> Endpoint { Endpoint(path: "/v1/files/roots/\(id)", method: .patch) }
    static func deleteFileRoot(id: String) -> Endpoint { Endpoint(path: "/v1/files/roots/\(id)", method: .delete) }
    static func reindexFileRoot(id: String) -> Endpoint { Endpoint(path: "/v1/files/roots/\(id)/reindex", method: .post) }
    static func fileSearch(query: String, rootId: String? = nil, workspaceId: String? = nil, limit: Int = 10) -> Endpoint {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let rootId { items.append(URLQueryItem(name: "rootId", value: rootId)) }
        if let workspaceId { items.append(URLQueryItem(name: "workspaceId", value: workspaceId)) }
        return Endpoint(path: "/v1/files/search", queryItems: items)
    }
    static func fileDocument(id: String) -> Endpoint { Endpoint(path: "/v1/files/documents/\(id)") }
    static func fileWriteIntents(rootId: String? = nil, status: String? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let rootId { items.append(URLQueryItem(name: "rootId", value: rootId)) }
        if let status { items.append(URLQueryItem(name: "status", value: status)) }
        return Endpoint(path: "/v1/files/write-intents", queryItems: items)
    }
    static func fileWriteIntent(id: String) -> Endpoint { Endpoint(path: "/v1/files/write-intents/\(id)") }
    static func reviewFileWriteIntent(id: String) -> Endpoint {
        Endpoint(path: "/v1/files/write-intents/\(id)/review", method: .post)
    }

    static let financeImports = Endpoint(path: "/v1/finance/imports")
    static let createFinanceImport = Endpoint(path: "/v1/finance/imports", method: .post)
    static func financeImport(id: String) -> Endpoint { Endpoint(path: "/v1/finance/imports/\(id)") }
    static func financeTransactions(importId: String? = nil, category: String? = nil, dateFrom: String? = nil, dateTo: String? = nil, limit: Int? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let importId { items.append(URLQueryItem(name: "importId", value: importId)) }
        if let category { items.append(URLQueryItem(name: "category", value: category)) }
        if let dateFrom { items.append(URLQueryItem(name: "dateFrom", value: dateFrom)) }
        if let dateTo { items.append(URLQueryItem(name: "dateTo", value: dateTo)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/finance/transactions", queryItems: items)
    }
    static let createFinanceTransaction = Endpoint(path: "/v1/finance/transactions", method: .post)
    static let createFinanceTransactionBatch = Endpoint(path: "/v1/finance/transactions/batch", method: .post)
    static func financeDocuments(importId: String? = nil) -> Endpoint {
        let items = importId.map { [URLQueryItem(name: "importId", value: $0)] } ?? []
        return Endpoint(path: "/v1/finance/documents", queryItems: items)
    }
    static func financeSearch(query: String, category: String? = nil, dateFrom: String? = nil, dateTo: String? = nil, limit: Int = 20) -> Endpoint {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let category { items.append(URLQueryItem(name: "category", value: category)) }
        if let dateFrom { items.append(URLQueryItem(name: "dateFrom", value: dateFrom)) }
        if let dateTo { items.append(URLQueryItem(name: "dateTo", value: dateTo)) }
        return Endpoint(path: "/v1/finance/search", queryItems: items)
    }
    static func financeDigest(period: String? = nil) -> Endpoint {
        let items = period.map { [URLQueryItem(name: "period", value: $0)] } ?? []
        return Endpoint(path: "/v1/finance/digest", queryItems: items)
    }
    static let triggerFinanceDigest = Endpoint(path: "/v1/finance/digest", method: .post)
    static func updateFinanceImportStatus(id: String) -> Endpoint {
        Endpoint(path: "/v1/finance/imports/\(id)/status", method: .post)
    }

    static let medicalImports = Endpoint(path: "/v1/medical/imports")
    static let createMedicalImport = Endpoint(path: "/v1/medical/imports", method: .post)
    static func medicalImport(id: String) -> Endpoint { Endpoint(path: "/v1/medical/imports/\(id)") }
    static func medicalAppointments(importId: String? = nil, limit: Int? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let importId { items.append(URLQueryItem(name: "importId", value: importId)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/medical/appointments", queryItems: items)
    }
    static let createMedicalAppointment = Endpoint(path: "/v1/medical/appointments", method: .post)
    static func medicalMedications(importId: String? = nil) -> Endpoint {
        let items = importId.map { [URLQueryItem(name: "importId", value: $0)] } ?? []
        return Endpoint(path: "/v1/medical/medications", queryItems: items)
    }
    static let createMedicalMedication = Endpoint(path: "/v1/medical/medications", method: .post)
    static func medicalDocuments(importId: String? = nil) -> Endpoint {
        let items = importId.map { [URLQueryItem(name: "importId", value: $0)] } ?? []
        return Endpoint(path: "/v1/medical/documents", queryItems: items)
    }
    static let createMedicalDocument = Endpoint(path: "/v1/medical/documents", method: .post)
    static func medicalSearch(query: String, limit: Int = 20) -> Endpoint {
        Endpoint(path: "/v1/medical/search", queryItems: [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ])
    }
    static func medicalDigest(period: String? = nil) -> Endpoint {
        let items = period.map { [URLQueryItem(name: "period", value: $0)] } ?? []
        return Endpoint(path: "/v1/medical/digest", queryItems: items)
    }
    static let triggerMedicalDigest = Endpoint(path: "/v1/medical/digest", method: .post)
    static func updateMedicalImportStatus(id: String) -> Endpoint {
        Endpoint(path: "/v1/medical/imports/\(id)/status", method: .post)
    }
}

// MARK: - Telegram

public extension Endpoint {
    static func telegramRelayCheckpoint(workspaceId: String) -> Endpoint {
        Endpoint(path: "/v1/telegram/relay/checkpoint", queryItems: [
            URLQueryItem(name: "workspaceId", value: workspaceId),
        ])
    }

    static func telegramUncertainDeliveries(workspaceId: String) -> Endpoint {
        Endpoint(path: "/v1/telegram/deliveries/uncertain", queryItems: [
            URLQueryItem(name: "workspaceId", value: workspaceId),
        ])
    }

    static func telegramDelivery(id: String) -> Endpoint {
        Endpoint(path: "/v1/telegram/deliveries/\(id)")
    }

    static func telegramDeliveryResolutions(id: String) -> Endpoint {
        Endpoint(path: "/v1/telegram/deliveries/\(id)/resolutions")
    }

    static func telegramDeliveryAttempts(id: String) -> Endpoint {
        Endpoint(path: "/v1/telegram/deliveries/\(id)/attempts")
    }

    static func telegramResolveDelivery(id: String) -> Endpoint {
        Endpoint(path: "/v1/telegram/deliveries/\(id)/resolve", method: .post)
    }

    static let telegramConfig = Endpoint(path: "/v1/config/telegram")
    static let saveTelegramConfig = Endpoint(path: "/v1/config/telegram", method: .post)
    static let applyTelegramConfig = Endpoint(path: "/v1/daemon/components/telegram/apply", method: .post)
    static let restartDaemon = Endpoint(path: "/v1/daemon/restart", method: .post)

    static func mutationReceipts(component: String? = nil, limit: Int? = nil) -> Endpoint {
        var items: [URLQueryItem] = []
        if let component { items.append(URLQueryItem(name: "component", value: component)) }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        return Endpoint(path: "/v1/governance/mutation-receipts", queryItems: items)
    }
}
