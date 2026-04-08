import Foundation

public struct ConnectionDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let domain: String
    public let providerKind: String
    public let label: String
    public let mode: String // read_only|read_write
    public let enabled: Bool
    public let resourceRules: [ConnectionResourceRuleDTO]?
    public let lastSyncAt: String?
    public let lastSyncStatus: String?
    public let policy: ConnectionPolicyDTO?
    public let health: ConnectionHealthDTO?
    public let sync: ConnectionSyncDTO?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        domain: String,
        providerKind: String,
        label: String,
        mode: String,
        enabled: Bool,
        resourceRules: [ConnectionResourceRuleDTO]? = nil,
        lastSyncAt: String?,
        lastSyncStatus: String?,
        policy: ConnectionPolicyDTO?,
        health: ConnectionHealthDTO?,
        sync: ConnectionSyncDTO?,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.domain = domain
        self.providerKind = providerKind
        self.label = label
        self.mode = mode
        self.enabled = enabled
        self.resourceRules = resourceRules
        self.lastSyncAt = lastSyncAt
        self.lastSyncStatus = lastSyncStatus
        self.policy = policy
        self.health = health
        self.sync = sync
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct ConnectionPolicyDTO: Codable, Sendable, Equatable {
    public let status: String // ready|disabled|incomplete
    public let secretStatus: String // not_required|configured|missing|stale
    public let mutatingRequiresApproval: Bool
    public let diagnostics: [ConnectionDiagnosticDTO]?

    public init(
        status: String,
        secretStatus: String,
        mutatingRequiresApproval: Bool,
        diagnostics: [ConnectionDiagnosticDTO]? = nil
    ) {
        self.status = status
        self.secretStatus = secretStatus
        self.mutatingRequiresApproval = mutatingRequiresApproval
        self.diagnostics = diagnostics
    }
}

public struct ConnectionHealthDTO: Codable, Sendable, Equatable {
    public let status: String // unknown|healthy|degraded|reauth_required|error
    public let authState: String // not_required|configured|missing|stale|expired|revoked|invalid_scopes
    public let checkedAt: String?
    public let lastError: String?
    public let diagnostics: [ConnectionDiagnosticDTO]?
    public let remediation: ConnectionRemediationDTO?

    public init(
        status: String,
        authState: String,
        checkedAt: String?,
        lastError: String?,
        diagnostics: [ConnectionDiagnosticDTO]? = nil,
        remediation: ConnectionRemediationDTO?
    ) {
        self.status = status
        self.authState = authState
        self.checkedAt = checkedAt
        self.lastError = lastError
        self.diagnostics = diagnostics
        self.remediation = remediation
    }
}

public struct ConnectionRemediationDTO: Codable, Sendable, Equatable {
    public let action: String // reauthorize|reconnect|scope_fix|secret_fix
    public let message: String
    public let updatedAt: String

    public init(action: String, message: String, updatedAt: String) {
        self.action = action
        self.message = message
        self.updatedAt = updatedAt
    }
}

public struct ConnectionSyncDTO: Codable, Sendable, Equatable {
    public let lastAttemptAt: String?
    public let lastSuccessAt: String?
    public let status: String // idle|success|partial|failed
    public let cursorKind: String?
    public let cursorPresent: Bool?
    public let lagSummary: String

    public init(
        lastAttemptAt: String?,
        lastSuccessAt: String?,
        status: String,
        cursorKind: String? = nil,
        cursorPresent: Bool? = nil,
        lagSummary: String
    ) {
        self.lastAttemptAt = lastAttemptAt
        self.lastSuccessAt = lastSuccessAt
        self.status = status
        self.cursorKind = cursorKind
        self.cursorPresent = cursorPresent
        self.lagSummary = lagSummary
    }
}

public struct ConnectionDiagnosticDTO: Codable, Sendable, Equatable, Identifiable {
    public let code: String
    public let severity: String
    public let message: String

    public var id: String { "\(severity):\(code):\(message)" }

    public init(code: String, severity: String, message: String) {
        self.code = code
        self.severity = severity
        self.message = message
    }
}

public struct ConnectionResourceRuleDTO: Codable, Sendable, Equatable, Identifiable {
    public let resourceType: String
    public let resourceId: String
    public let displayName: String
    public let writeAllowed: Bool
    public let createdAt: String?
    public let updatedAt: String?

    public var id: String { "\(resourceType):\(resourceId)" }

    public init(
        resourceType: String,
        resourceId: String,
        displayName: String,
        writeAllowed: Bool,
        createdAt: String? = nil,
        updatedAt: String? = nil
    ) {
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.displayName = displayName
        self.writeAllowed = writeAllowed
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct ConnectionResourceRuleCreateInput: Encodable, Sendable, Equatable {
    public let resourceType: String
    public let resourceId: String
    public let displayName: String
    public let writeAllowed: Bool

    public init(resourceType: String, resourceId: String, displayName: String, writeAllowed: Bool) {
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.displayName = displayName
        self.writeAllowed = writeAllowed
    }
}

public struct ConnectionResourceRuleDeleteInput: Encodable, Sendable, Equatable {
    public let resourceType: String
    public let resourceId: String

    public init(resourceType: String, resourceId: String) {
        self.resourceType = resourceType
        self.resourceId = resourceId
    }
}

public struct ConnectionReconnectInput: Encodable, Sendable, Equatable {
    public let action: String

    public init(action: String) {
        self.action = action
    }
}

public struct ConnectionUpdateInput: Encodable, Sendable, Equatable {
    public let label: String?
    public let mode: String?
    public let secretRefId: String?
    public let enabled: Bool?
    public let syncIntervalSeconds: Int?
    public let allowedScopes: [String]?
    public let allowedResources: [String]?
    public let resourceRules: [ConnectionResourceRuleCreateInput]?

    public init(
        label: String? = nil,
        mode: String? = nil,
        secretRefId: String? = nil,
        enabled: Bool? = nil,
        syncIntervalSeconds: Int? = nil,
        allowedScopes: [String]? = nil,
        allowedResources: [String]? = nil,
        resourceRules: [ConnectionResourceRuleCreateInput]? = nil
    ) {
        self.label = label
        self.mode = mode
        self.secretRefId = secretRefId
        self.enabled = enabled
        self.syncIntervalSeconds = syncIntervalSeconds
        self.allowedScopes = allowedScopes
        self.allowedResources = allowedResources
        self.resourceRules = resourceRules
    }
}

public struct ConnectionDiagnosticsDTO: Codable, Sendable, Equatable {
    public let connectionId: String
    public let label: String
    public let providerKind: String
    public let domain: String
    public let enabled: Bool
    public let health: ConnectionHealthDTO
    public let sync: ConnectionSyncDTO
    public let policy: ConnectionPolicyDTO
    public let remediation: ConnectionRemediationDTO?
    public let humanSummary: String

    public init(
        connectionId: String,
        label: String,
        providerKind: String,
        domain: String,
        enabled: Bool,
        health: ConnectionHealthDTO,
        sync: ConnectionSyncDTO,
        policy: ConnectionPolicyDTO,
        remediation: ConnectionRemediationDTO?,
        humanSummary: String
    ) {
        self.connectionId = connectionId
        self.label = label
        self.providerKind = providerKind
        self.domain = domain
        self.enabled = enabled
        self.health = health
        self.sync = sync
        self.policy = policy
        self.remediation = remediation
        self.humanSummary = humanSummary
    }
}
