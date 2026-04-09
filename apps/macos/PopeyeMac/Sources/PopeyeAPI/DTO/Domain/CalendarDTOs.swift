import Foundation

public struct CalendarAccountDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let connectionId: String
    public let calendarEmail: String
    public let displayName: String
    public let timeZone: String
    public let syncCursorSyncToken: String?
    public let lastSyncAt: String?
    public let eventCount: Int
    public let createdAt: String
    public let updatedAt: String
}

public struct CalendarEventDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let googleEventId: String
    public let title: String
    public let description: String
    public let location: String
    public let startTime: String
    public let endTime: String
    public let isAllDay: Bool
    public let status: String
    public let organizer: String
    public let attendees: [String]
    public let recurrenceRule: String?
    public let htmlLink: String?
    public let createdAtGoogle: String?
    public let updatedAtGoogle: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct CalendarDigestDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let workspaceId: String
    public let date: String
    public let todayEventCount: Int
    public let upcomingCount: Int
    public let summaryMarkdown: String
    public let generatedAt: String
}

public struct CalendarSyncResultDTO: Codable, Sendable, Equatable {
    public let accountId: String
    public let eventsSynced: Int
    public let eventsUpdated: Int
    public let errors: [String]
}

public struct CalendarEventCreateInput: Encodable, Sendable, Equatable {
    public let accountId: String
    public let title: String
    public let description: String
    public let location: String
    public let startTime: String
    public let endTime: String
    public let attendees: [String]

    public init(
        accountId: String,
        title: String,
        description: String = "",
        location: String = "",
        startTime: String,
        endTime: String,
        attendees: [String] = []
    ) {
        self.accountId = accountId
        self.title = title
        self.description = description
        self.location = location
        self.startTime = startTime
        self.endTime = endTime
        self.attendees = attendees
    }
}

public struct CalendarEventUpdateInput: Encodable, Sendable, Equatable {
    public let title: String?
    public let description: String?
    public let location: String?
    public let startTime: String?
    public let endTime: String?
    public let attendees: [String]?
    public let status: String?

    public init(
        title: String? = nil,
        description: String? = nil,
        location: String? = nil,
        startTime: String? = nil,
        endTime: String? = nil,
        attendees: [String]? = nil,
        status: String? = nil
    ) {
        self.title = title
        self.description = description
        self.location = location
        self.startTime = startTime
        self.endTime = endTime
        self.attendees = attendees
        self.status = status
    }
}
