import Foundation
import Testing

@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("Calendar Store")
struct CalendarStoreTests {
    @Test("Load selects the default account and event detail")
    func loadHydratesSelectedEvent() async {
        let store = CalendarStore(dependencies: .stub())

        await store.load()

        #expect(store.accounts.count == 1)
        #expect(store.selectedAccountID == "calendar-acct-1")
        #expect(store.selectedEventID == "event-1")
        #expect(store.selectedEvent?.id == "event-1")
    }

    @Test("Sync updates the account operations summary")
    func syncUpdatesSummary() async {
        let store = CalendarStore(dependencies: .stub(
            syncAccount: { accountId in
                CalendarSyncResultDTO(accountId: accountId, eventsSynced: 5, eventsUpdated: 2, errors: [])
            }
        ))

        await store.load()
        await store.syncSelectedAccount()

        #expect(store.visibleSyncResult?.eventsSynced == 5)
        #expect(store.mutationState == .succeeded("Calendar synced"))
    }

    @Test("Creating an event reloads and selects the created event")
    func createEventReloadsSelection() async {
        let state = CalendarStateBox(initial: sampleCalendarEvent())
        let store = CalendarStore(dependencies: .stub(
            loadEvents: { accountId, _, _, _ in
                await state.listEvents(accountId: accountId)
            },
            loadEvent: { id in
                await state.loadEvent(id: id)
            },
            createEvent: { input in
                await state.createEvent(input: input)
            }
        ))

        await store.load()
        store.beginCreateEvent()
        store.editor?.title = "Planning session"
        store.editor?.location = "HQ"
        store.editor?.startDate = sampleStartDate().addingTimeInterval(7200)
        store.editor?.endDate = sampleStartDate().addingTimeInterval(10800)
        store.editor?.attendeesText = "annie@example.com, ben@example.com"
        await store.saveEditor()

        #expect(store.selectedEvent?.title == "Planning session")
        #expect(store.selectedEventID == "event-created")
        #expect(store.editor == nil)
        #expect(store.mutationState == .succeeded("Calendar event created"))
    }

    @Test("Editing an event reloads the updated detail")
    func updateEventReloadsSelection() async {
        let state = CalendarStateBox(initial: sampleCalendarEvent())
        let store = CalendarStore(dependencies: .stub(
            loadEvents: { accountId, _, _, _ in
                await state.listEvents(accountId: accountId)
            },
            loadEvent: { id in
                await state.loadEvent(id: id)
            },
            updateEvent: { id, input in
                await state.updateEvent(id: id, input: input)
            }
        ))

        await store.load()
        store.beginEditSelectedEvent()
        store.editor?.title = "Updated standup"
        store.editor?.status = "tentative"
        await store.saveEditor()

        #expect(store.selectedEvent?.title == "Updated standup")
        #expect(store.selectedEvent?.status == "tentative")
        #expect(store.mutationState == .succeeded("Calendar event updated"))
    }

    @Test("Editor validation enforces title and chronological range")
    func editorValidation() async {
        let store = CalendarStore(dependencies: .stub())

        await store.load()
        store.beginCreateEvent()
        store.editor?.title = ""
        #expect(store.editorValidationMessage == "Enter an event title.")

        store.editor?.title = "Weekly sync"
        store.editor?.startDate = sampleStartDate()
        store.editor?.endDate = sampleStartDate().addingTimeInterval(-60)
        #expect(store.editorValidationMessage == "End time must be after the start time.")

        store.editor?.endDate = sampleStartDate().addingTimeInterval(3600)
        #expect(store.editorValidationMessage == nil)
        #expect(store.canSaveEditor == true)
    }
}

extension CalendarStore.Dependencies {
    fileprivate static func stub(
        loadAccounts: @escaping @Sendable () async throws -> [CalendarAccountDTO] = {
            [sampleCalendarAccount()]
        },
        loadEvents: @escaping @Sendable (_ accountId: String, _ dateFrom: String?, _ dateTo: String?, _ limit: Int) async throws -> [CalendarEventDTO] = { accountId, _, _, _ in
            [sampleCalendarEvent(accountId: accountId)]
        },
        loadEvent: @escaping @Sendable (_ id: String) async throws -> CalendarEventDTO = { _ in
            sampleCalendarEvent()
        },
        loadDigest: @escaping @Sendable (_ accountId: String) async throws -> CalendarDigestDTO? = { accountId in
            sampleCalendarDigest(accountId: accountId)
        },
        syncAccount: @escaping @Sendable (_ accountId: String) async throws -> CalendarSyncResultDTO = { accountId in
            CalendarSyncResultDTO(accountId: accountId, eventsSynced: 2, eventsUpdated: 1, errors: [])
        },
        createEvent: @escaping @Sendable (_ input: CalendarEventCreateInput) async throws -> CalendarEventDTO = { input in
            sampleCalendarEvent(
                id: "event-created",
                accountId: input.accountId,
                title: input.title,
                location: input.location,
                startTime: input.startTime,
                endTime: input.endTime,
                attendees: input.attendees
            )
        },
        updateEvent: @escaping @Sendable (_ id: String, _ input: CalendarEventUpdateInput) async throws -> CalendarEventDTO = { _, input in
            sampleCalendarEvent(
                title: input.title ?? "Team standup",
                description: input.description ?? "",
                location: input.location ?? "Zoom",
                startTime: input.startTime ?? sampleStartDateString(),
                endTime: input.endTime ?? sampleEndDateString(),
                attendees: input.attendees ?? ["annie@example.com"],
                status: input.status ?? "confirmed"
            )
        },
        emitInvalidation: @escaping @Sendable (_ signal: InvalidationSignal) -> Void = { _ in }
    ) -> Self {
        Self(
            loadAccounts: loadAccounts,
            loadEvents: loadEvents,
            loadEvent: loadEvent,
            loadDigest: loadDigest,
            syncAccount: syncAccount,
            createEvent: createEvent,
            updateEvent: updateEvent,
            emitInvalidation: emitInvalidation
        )
    }
}

private actor CalendarStateBox {
    private var event: CalendarEventDTO

    init(initial: CalendarEventDTO) {
        event = initial
    }

    func listEvents(accountId: String) -> [CalendarEventDTO] {
        guard event.accountId == accountId else { return [] }
        return [event]
    }

    func loadEvent(id: String) -> CalendarEventDTO {
        precondition(event.id == id)
        return event
    }

    func createEvent(input: CalendarEventCreateInput) -> CalendarEventDTO {
        event = sampleCalendarEvent(
            id: "event-created",
            accountId: input.accountId,
            title: input.title,
            description: input.description,
            location: input.location,
            startTime: input.startTime,
            endTime: input.endTime,
            attendees: input.attendees
        )
        return event
    }

    func updateEvent(id: String, input: CalendarEventUpdateInput) -> CalendarEventDTO {
        precondition(event.id == id)
        event = sampleCalendarEvent(
            id: event.id,
            accountId: event.accountId,
            title: input.title ?? event.title,
            description: input.description ?? event.description,
            location: input.location ?? event.location,
            startTime: input.startTime ?? event.startTime,
            endTime: input.endTime ?? event.endTime,
            attendees: input.attendees ?? event.attendees,
            status: input.status ?? event.status
        )
        return event
    }
}

private func sampleCalendarAccount() -> CalendarAccountDTO {
    CalendarAccountDTO(
        id: "calendar-acct-1",
        connectionId: "conn-cal-1",
        calendarEmail: "operator@example.com",
        displayName: "Work",
        timeZone: "Europe/Vienna",
        syncCursorSyncToken: nil,
        lastSyncAt: "2026-04-09T09:00:00Z",
        eventCount: 4,
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-09T09:00:00Z"
    )
}

private func sampleCalendarEvent(
    id: String = "event-1",
    accountId: String = "calendar-acct-1",
    title: String = "Team standup",
    description: String = "Daily planning",
    location: String = "Zoom",
    startTime: String = sampleStartDateString(),
    endTime: String = sampleEndDateString(),
    attendees: [String] = ["annie@example.com"],
    status: String = "confirmed"
) -> CalendarEventDTO {
    CalendarEventDTO(
        id: id,
        accountId: accountId,
        googleEventId: "google-\(id)",
        title: title,
        description: description,
        location: location,
        startTime: startTime,
        endTime: endTime,
        isAllDay: false,
        status: status,
        organizer: "operator@example.com",
        attendees: attendees,
        recurrenceRule: nil,
        htmlLink: nil,
        createdAtGoogle: "2026-04-01T08:00:00Z",
        updatedAtGoogle: "2026-04-09T09:00:00Z",
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-09T09:00:00Z"
    )
}

private func sampleCalendarDigest(accountId: String) -> CalendarDigestDTO {
    CalendarDigestDTO(
        id: "digest-1",
        accountId: accountId,
        workspaceId: "default",
        date: "2026-04-09",
        todayEventCount: 2,
        upcomingCount: 4,
        summaryMarkdown: "Two meetings today and four upcoming events this week.",
        generatedAt: "2026-04-09T09:00:00Z"
    )
}

private func sampleStartDate() -> Date {
    Calendar.current.date(from: DateComponents(
        calendar: Calendar(identifier: .gregorian),
        timeZone: TimeZone(secondsFromGMT: 0),
        year: 2026,
        month: 4,
        day: 10,
        hour: 9,
        minute: 0
    )) ?? .now
}

private func sampleStartDateString() -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: sampleStartDate())
}

private func sampleEndDateString() -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: sampleStartDate().addingTimeInterval(3600))
}
