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
