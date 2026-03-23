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
    static let schedulerStatus = Endpoint(path: "/v1/daemon/scheduler")
    static let engineCapabilities = Endpoint(path: "/v1/engine/capabilities")
    static let usageSummary = Endpoint(path: "/v1/usage/summary")
    static let csrfToken = Endpoint(path: "/v1/security/csrf-token")
    static let securityAudit = Endpoint(path: "/v1/security/audit")
    static let daemonState = Endpoint(path: "/v1/daemon/state")
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
    static func approval(id: String) -> Endpoint { Endpoint(path: "/v1/approvals/\(id)") }
    static func resolveApproval(id: String) -> Endpoint {
        Endpoint(path: "/v1/approvals/\(id)/resolve", method: .post)
    }
}

// MARK: - Connections

public extension Endpoint {
    static let connections = Endpoint(path: "/v1/connections")
}

// MARK: - Memory Endpoints

public extension Endpoint {
    static let memories = Endpoint(path: "/v1/memory")

    static func memorySearch(query: String, limit: Int = 20, scope: String? = nil, types: String? = nil, domains: String? = nil, full: Bool = false) -> Endpoint {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if full { items.append(URLQueryItem(name: "full", value: "true")) }
        if let scope { items.append(URLQueryItem(name: "scope", value: scope)) }
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
}
