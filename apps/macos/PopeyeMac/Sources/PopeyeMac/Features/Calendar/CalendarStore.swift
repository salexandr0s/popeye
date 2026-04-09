import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class CalendarStore {
    struct EventEditor: Equatable, Sendable {
        enum Mode: String, Sendable {
            case create
            case edit
        }

        var mode: Mode
        var eventID: String?
        var title: String
        var description: String
        var location: String
        var startDate: Date
        var endDate: Date
        var attendeesText: String
        var status: String
    }

    struct Dependencies: Sendable {
        var loadAccounts: @Sendable () async throws -> [CalendarAccountDTO]
        var loadEvents: @Sendable (_ accountId: String, _ dateFrom: String?, _ dateTo: String?, _ limit: Int) async throws -> [CalendarEventDTO]
        var loadEvent: @Sendable (_ id: String) async throws -> CalendarEventDTO
        var loadDigest: @Sendable (_ accountId: String) async throws -> CalendarDigestDTO?
        var syncAccount: @Sendable (_ accountId: String) async throws -> CalendarSyncResultDTO
        var createEvent: @Sendable (_ input: CalendarEventCreateInput) async throws -> CalendarEventDTO
        var updateEvent: @Sendable (_ id: String, _ input: CalendarEventUpdateInput) async throws -> CalendarEventDTO
        var emitInvalidation: @Sendable (_ signal: InvalidationSignal) -> Void

        static func live(client: ControlAPIClient) -> Dependencies {
            let service = CalendarDomainService(client: client)
            return Dependencies(
                loadAccounts: { try await service.loadAccounts() },
                loadEvents: { accountId, dateFrom, dateTo, limit in
                    try await service.loadEvents(accountId: accountId, dateFrom: dateFrom, dateTo: dateTo, limit: limit)
                },
                loadEvent: { id in try await service.loadEvent(id: id) },
                loadDigest: { accountId in try await service.loadDigest(accountId: accountId) },
                syncAccount: { accountId in try await service.sync(accountId: accountId) },
                createEvent: { input in try await service.createEvent(input: input) },
                updateEvent: { id, input in try await service.updateEvent(id: id, input: input) },
                emitInvalidation: { signal in
                    NotificationCenter.default.post(name: .popeyeInvalidation, object: signal)
                }
            )
        }
    }

    var accounts: [CalendarAccountDTO] = []
    var events: [CalendarEventDTO] = []
    var digest: CalendarDigestDTO?
    var selectedAccountID: String?
    var selectedEventID: String?
    var selectedEvent: CalendarEventDTO?
    var isLoading = false
    var error: APIError?
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            accounts = []
            events = []
            selectedAccountID = nil
            selectedEventID = nil
            selectedEvent = nil
            digest = nil
            lastSyncResult = nil
            editor = nil
            mutations.dismiss()
            error = nil
            isLoading = false
        }
    }

    var editor: EventEditor?
    var lastSyncResult: CalendarSyncResultDTO?

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let dependencies: Dependencies
    private var pendingSelectionEventID: String?

    init(client: ControlAPIClient) {
        self.dependencies = .live(client: client)
    }

    init(dependencies: Dependencies) {
        self.dependencies = dependencies
    }

    var activeAccount: CalendarAccountDTO? {
        guard let selectedAccountID else { return accounts.first }
        return accounts.first(where: { $0.id == selectedAccountID }) ?? accounts.first
    }

    var visibleSyncResult: CalendarSyncResultDTO? {
        guard let activeAccount else { return nil }
        guard lastSyncResult?.accountId == activeAccount.id else { return nil }
        return lastSyncResult
    }

    var canSyncSelectedAccount: Bool {
        activeAccount != nil && mutationState != .executing
    }

    var canCreateEvent: Bool {
        activeAccount != nil && mutationState != .executing
    }

    var canEditSelectedEvent: Bool {
        selectedEvent != nil && mutationState != .executing
    }

    var editorValidationMessage: String? {
        guard let editor else { return nil }
        if editor.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Enter an event title."
        }
        if editor.endDate <= editor.startDate {
            return "End time must be after the start time."
        }
        return nil
    }

    var canSaveEditor: Bool {
        editor != nil && editorValidationMessage == nil && mutationState != .executing
    }

    func load() async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            accounts = try await dependencies.loadAccounts()
            if selectedAccountID == nil || accounts.contains(where: { $0.id == selectedAccountID }) == false {
                selectedAccountID = accounts.first?.id
            }

            guard let selectedAccountID else {
                events = []
                digest = nil
                selectedEvent = nil
                selectedEventID = nil
                return
            }

            let bounds = DateWindow.nextSevenDays()
            async let loadedEvents = dependencies.loadEvents(selectedAccountID, bounds.from, bounds.to, 80)
            async let loadedDigest = dependencies.loadDigest(selectedAccountID)

            events = try await loadedEvents
            digest = try await loadedDigest

            if let pendingSelectionEventID, events.contains(where: { $0.id == pendingSelectionEventID }) {
                selectedEventID = pendingSelectionEventID
            } else if let selectedEventID, events.contains(where: { $0.id == selectedEventID }) {
                self.selectedEventID = selectedEventID
            } else {
                self.selectedEventID = events.first?.id
            }
            pendingSelectionEventID = nil

            if let selectedEventID {
                selectedEvent = try await dependencies.loadEvent(selectedEventID)
            } else {
                selectedEvent = nil
            }
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
    }

    func loadEvent(id: String) async {
        do {
            selectedEvent = try await dependencies.loadEvent(id)
        } catch {
            PopeyeLogger.refresh.error("Calendar event load failed: \(error)")
        }
    }

    func syncSelectedAccount() async {
        guard let account = activeAccount else { return }
        await mutations.execute(
            action: {
                self.lastSyncResult = try await self.dependencies.syncAccount(account.id)
                self.dependencies.emitInvalidation(.general)
            },
            successMessage: "Calendar synced",
            fallbackError: "Couldn't sync calendar",
            reload: { [weak self] in
                await self?.load()
            }
        )
    }

    func beginCreateEvent() {
        guard activeAccount != nil else { return }
        let now = Date()
        let end = now.addingTimeInterval(60 * 60)
        editor = EventEditor(
            mode: .create,
            eventID: nil,
            title: "",
            description: "",
            location: "",
            startDate: now,
            endDate: end,
            attendeesText: "",
            status: "confirmed"
        )
    }

    func beginEditSelectedEvent() {
        guard let event = selectedEvent else { return }
        editor = EventEditor(
            mode: .edit,
            eventID: event.id,
            title: event.title,
            description: event.description,
            location: event.location,
            startDate: Self.parseDate(event.startTime) ?? .now,
            endDate: Self.parseDate(event.endTime) ?? .now.addingTimeInterval(60 * 60),
            attendeesText: event.attendees.joined(separator: ", "),
            status: event.status
        )
    }

    func cancelEditor() {
        editor = nil
    }

    func saveEditor() async {
        guard let editor, canSaveEditor else { return }
        switch editor.mode {
        case .create:
            guard let account = activeAccount else { return }
            await mutations.execute(
                action: {
                    let created = try await self.dependencies.createEvent(
                        CalendarEventCreateInput(
                            accountId: account.id,
                            title: editor.title.trimmingCharacters(in: .whitespacesAndNewlines),
                            description: editor.description.trimmingCharacters(in: .whitespacesAndNewlines),
                            location: editor.location.trimmingCharacters(in: .whitespacesAndNewlines),
                            startTime: Self.formatDate(editor.startDate),
                            endTime: Self.formatDate(editor.endDate),
                            attendees: Self.parseAttendees(editor.attendeesText)
                        )
                    )
                    self.pendingSelectionEventID = created.id
                    self.editor = nil
                    self.dependencies.emitInvalidation(.general)
                },
                successMessage: "Calendar event created",
                fallbackError: "Couldn't create calendar event",
                reload: { [weak self] in
                    await self?.load()
                }
            )
        case .edit:
            guard let eventID = editor.eventID else { return }
            await mutations.execute(
                action: {
                    let updated = try await self.dependencies.updateEvent(
                        eventID,
                        CalendarEventUpdateInput(
                            title: editor.title.trimmingCharacters(in: .whitespacesAndNewlines),
                            description: editor.description.trimmingCharacters(in: .whitespacesAndNewlines),
                            location: editor.location.trimmingCharacters(in: .whitespacesAndNewlines),
                            startTime: Self.formatDate(editor.startDate),
                            endTime: Self.formatDate(editor.endDate),
                            attendees: Self.parseAttendees(editor.attendeesText),
                            status: editor.status
                        )
                    )
                    self.pendingSelectionEventID = updated.id
                    self.editor = nil
                    self.dependencies.emitInvalidation(.general)
                },
                successMessage: "Calendar event updated",
                fallbackError: "Couldn't update calendar event",
                reload: { [weak self] in
                    await self?.load()
                }
            )
        }
    }

    func dismissMutation() {
        mutations.dismiss()
    }

    private static func parseAttendees(_ value: String) -> [String] {
        value
            .split(whereSeparator: { $0 == "," || $0 == "\n" })
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private static func parseDate(_ value: String) -> Date? {
        if let date = makeFractionalISO8601Formatter().date(from: value) {
            return date
        }
        return makeBasicISO8601Formatter().date(from: value)
    }

    fileprivate static func formatDate(_ date: Date) -> String {
        makeFractionalISO8601Formatter().string(from: date)
    }

    private static func makeFractionalISO8601Formatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }

    private static func makeBasicISO8601Formatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }
}

private struct DateWindow {
    let from: String
    let to: String

    @MainActor
    static func nextSevenDays() -> DateWindow {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: .now)
        let end = calendar.date(byAdding: .day, value: 7, to: start) ?? start
        return DateWindow(
            from: CalendarStore.formatDate(start),
            to: CalendarStore.formatDate(end)
        )
    }
}
