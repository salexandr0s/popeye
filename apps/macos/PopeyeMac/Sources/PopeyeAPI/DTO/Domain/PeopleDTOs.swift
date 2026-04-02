import Foundation

public struct PersonIdentityDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let personId: String
    public let provider: String
    public let externalId: String
    public let displayName: String?
    public let handle: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct PersonContactMethodDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let personId: String
    public let type: String
    public let value: String
    public let label: String?
    public let source: String
    public let createdAt: String
    public let updatedAt: String
}

public struct PersonPolicyDTO: Codable, Sendable, Equatable {
    public let personId: String
    public let relationshipLabel: String?
    public let reminderRouting: String?
    public let approvalNotes: String?
    public let updatedAt: String
}

public struct PersonDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let displayName: String
    public let pronouns: String?
    public let tags: [String]
    public let notes: String
    public let canonicalEmail: String?
    public let githubLogin: String?
    public let activitySummary: String
    public let identityCount: Int
    public let contactMethodCount: Int
    public let policy: PersonPolicyDTO?
    public let identities: [PersonIdentityDTO]
    public let contactMethods: [PersonContactMethodDTO]
    public let createdAt: String
    public let updatedAt: String
}

public struct PersonSearchResultDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { personId }
    public let personId: String
    public let displayName: String
    public let canonicalEmail: String?
    public let githubLogin: String?
    public let score: Double
}

public struct PersonSearchResponseDTO: Codable, Sendable, Equatable {
    public let query: String
    public let results: [PersonSearchResultDTO]
}

public struct PersonMergeEventDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let eventType: String
    public let sourcePersonId: String?
    public let targetPersonId: String?
    public let identityId: String?
    public let requestedBy: String
    public let createdAt: String
}

public struct PersonMergeSuggestionDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { "\(sourcePersonId)->\(targetPersonId)" }
    public let sourcePersonId: String
    public let targetPersonId: String
    public let sourceDisplayName: String
    public let targetDisplayName: String
    public let reason: String
    public let confidence: Double
}

public struct PersonActivityRollupDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { "\(personId):\(domain)" }
    public let personId: String
    public let domain: String
    public let summary: String
    public let count: Int
    public let lastSeenAt: String
}

public struct PersonMergeInput: Encodable, Sendable {
    public let sourcePersonId: String
    public let targetPersonId: String
    public let requestedBy: String

    public init(sourcePersonId: String, targetPersonId: String, requestedBy: String = "operator") {
        self.sourcePersonId = sourcePersonId
        self.targetPersonId = targetPersonId
        self.requestedBy = requestedBy
    }
}

public struct PersonSplitInput: Encodable, Sendable {
    public let identityIds: [String]
    public let displayName: String?
    public let requestedBy: String

    public init(identityIds: [String], displayName: String? = nil, requestedBy: String = "operator") {
        self.identityIds = identityIds
        self.displayName = displayName
        self.requestedBy = requestedBy
    }
}

public struct PersonIdentityAttachInput: Encodable, Sendable {
    public let personId: String
    public let provider: String
    public let externalId: String
    public let displayName: String?
    public let handle: String?
    public let requestedBy: String

    public init(
        personId: String,
        provider: String,
        externalId: String,
        displayName: String? = nil,
        handle: String? = nil,
        requestedBy: String = "operator"
    ) {
        self.personId = personId
        self.provider = provider
        self.externalId = externalId
        self.displayName = displayName
        self.handle = handle
        self.requestedBy = requestedBy
    }
}

public struct PersonIdentityDetachInput: Encodable, Sendable {
    public let requestedBy: String

    public init(requestedBy: String = "operator") {
        self.requestedBy = requestedBy
    }
}
