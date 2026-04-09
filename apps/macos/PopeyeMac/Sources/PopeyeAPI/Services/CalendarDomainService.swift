import Foundation

public struct CalendarDomainService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadAccounts() async throws -> [CalendarAccountDTO] {
        try await client.listCalendarAccounts()
    }

    public func loadEvents(accountId: String, dateFrom: String? = nil, dateTo: String? = nil, limit: Int = 80) async throws -> [CalendarEventDTO] {
        try await client.listCalendarEvents(accountId: accountId, dateFrom: dateFrom, dateTo: dateTo, limit: limit)
    }

    public func loadEvent(id: String) async throws -> CalendarEventDTO {
        try await client.getCalendarEvent(id: id)
    }

    public func loadDigest(accountId: String) async throws -> CalendarDigestDTO? {
        try await client.calendarDigest(accountId: accountId)
    }

    public func sync(accountId: String) async throws -> CalendarSyncResultDTO {
        try await client.syncCalendarAccount(accountId: accountId)
    }

    public func createEvent(input: CalendarEventCreateInput) async throws -> CalendarEventDTO {
        try await client.createCalendarEvent(input: input)
    }

    public func updateEvent(id: String, input: CalendarEventUpdateInput) async throws -> CalendarEventDTO {
        try await client.updateCalendarEvent(id: id, input: input)
    }
}
