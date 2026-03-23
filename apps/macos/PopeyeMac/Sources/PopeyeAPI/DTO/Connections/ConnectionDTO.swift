import Foundation

public struct ConnectionDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let domain: String
    public let providerKind: String
    public let label: String
    public let mode: String // read_only|read_write
    public let enabled: Bool
    public let lastSyncAt: String?
    public let lastSyncStatus: String?
    public let policy: ConnectionPolicyDTO?
    public let health: ConnectionHealthDTO?
    public let sync: ConnectionSyncDTO?
    public let createdAt: String
    public let updatedAt: String
}

public struct ConnectionPolicyDTO: Codable, Sendable {
    public let status: String // ready|disabled|incomplete
    public let secretStatus: String // not_required|configured|missing|stale
    public let mutatingRequiresApproval: Bool
}

public struct ConnectionHealthDTO: Codable, Sendable {
    public let status: String // unknown|healthy|degraded|reauth_required|error
    public let authState: String // not_required|configured|missing|stale|expired|revoked|invalid_scopes
    public let checkedAt: String?
    public let lastError: String?
    public let remediation: ConnectionRemediationDTO?
}

public struct ConnectionRemediationDTO: Codable, Sendable {
    public let action: String // reauthorize|reconnect|scope_fix|secret_fix
    public let message: String
    public let updatedAt: String
}

public struct ConnectionSyncDTO: Codable, Sendable {
    public let lastAttemptAt: String?
    public let lastSuccessAt: String?
    public let status: String // idle|success|partial|failed
    public let lagSummary: String
}
