import AppKit
import SwiftUI
import Testing
@testable import PopeyeAPI
@testable import PopeyeMac

@MainActor
@Suite("SwiftUI Render Smoke")
struct SwiftUIRenderSmokeTests {
    @Test("Settings view renders with preview state")
    func rendersSettingsView() {
        let appModel = FeaturePreviewFixtures.previewAppModel()
        appModel.connectionState = .connected
        appModel.sseConnected = true

        assertRenders(
            SettingsView(
                diagnosticsResult: DiagnosticsResult(healthy: true, latencyMs: 42, error: nil)
            )
            .environment(appModel)
        )
    }

    @Test("Control changes section renders with fixture data")
    func rendersControlChangesSection() {
        assertRenders(
            ControlChangesSection(receipts: FeaturePreviewFixtures.homeSummary.controlChanges)
        )
    }

    @Test("Dashboard view renders with populated preview state")
    func rendersDashboardView() {
        assertRenders(
            NavigationStack {
                DashboardView(store: .previewPopulated())
            }
        )
    }

    @Test("Usage & Security view renders with governance data")
    func rendersUsageSecurityView() async {
        let store = UsageSecurityStore(dependencies: .stub())
        await store.load()

        assertRenders(
            NavigationStack {
                UsageSecurityView(store: store)
            }
        )
    }

    @Test("Todos view renders with actionable item detail")
    func rendersTodosView() async {
        let appModel = FeaturePreviewFixtures.previewAppModel()
        appModel.connectionState = .connected
        appModel.sseConnected = true
        let store = TodosStore(
            dependencies: .init(
                loadAccounts: {
                    [TodoAccountDTO(
                        id: "todo-acct-1",
                        connectionId: "conn-todo-1",
                        providerKind: "google_tasks",
                        displayName: "Personal Tasks",
                        syncCursorSince: nil,
                        lastSyncAt: "2026-04-08T09:00:00Z",
                        todoCount: 2,
                        createdAt: "2026-04-01T08:00:00Z",
                        updatedAt: "2026-04-08T09:00:00Z"
                    )]
                },
                loadItems: { _, _, _ in
                    [TodoItemDTO(
                        id: "todo-1",
                        accountId: "todo-acct-1",
                        externalId: "ext-1",
                        title: "Review inbox triage",
                        description: "Check new PRs and route follow-ups.",
                        priority: 2,
                        status: "pending",
                        dueDate: "2026-04-10",
                        dueTime: "09:30",
                        labels: ["today"],
                        projectId: "inbox",
                        projectName: "Inbox",
                        parentId: nil,
                        completedAt: nil,
                        createdAtExternal: "2026-04-01T08:00:00Z",
                        updatedAtExternal: "2026-04-08T09:00:00Z",
                        createdAt: "2026-04-01T08:00:00Z",
                        updatedAt: "2026-04-08T09:00:00Z"
                    )]
                },
                loadItem: { _ in
                    TodoItemDTO(
                        id: "todo-1",
                        accountId: "todo-acct-1",
                        externalId: "ext-1",
                        title: "Review inbox triage",
                        description: "Check new PRs and route follow-ups.",
                        priority: 2,
                        status: "pending",
                        dueDate: "2026-04-10",
                        dueTime: "09:30",
                        labels: ["today"],
                        projectId: "inbox",
                        projectName: "Inbox",
                        parentId: nil,
                        completedAt: nil,
                        createdAtExternal: "2026-04-01T08:00:00Z",
                        updatedAtExternal: "2026-04-08T09:00:00Z",
                        createdAt: "2026-04-01T08:00:00Z",
                        updatedAt: "2026-04-08T09:00:00Z"
                    )
                },
                loadProjects: { _ in
                    [
                        TodoProjectDTO(
                            id: "project-inbox",
                            accountId: "todo-acct-1",
                            externalId: "ext-inbox",
                            name: "Inbox",
                            color: "#448AFF",
                            todoCount: 1,
                            createdAt: "2026-04-01T08:00:00Z",
                            updatedAt: "2026-04-08T09:00:00Z"
                        ),
                        TodoProjectDTO(
                            id: "project-today",
                            accountId: "todo-acct-1",
                            externalId: "ext-today",
                            name: "Today",
                            color: "#66BB6A",
                            todoCount: 1,
                            createdAt: "2026-04-01T08:00:00Z",
                            updatedAt: "2026-04-08T09:00:00Z"
                        )
                    ]
                },
                loadDigest: { _ in
                    TodoDigestDTO(
                        id: "digest-1",
                        accountId: "todo-acct-1",
                        workspaceId: "default",
                        date: "2026-04-08",
                        pendingCount: 2,
                        overdueCount: 0,
                        completedTodayCount: 1,
                        summaryMarkdown: "Two tasks need attention today.",
                        generatedAt: "2026-04-08T09:00:00Z"
                    )
                },
                syncAccount: { accountId in
                    TodoSyncResultDTO(accountId: accountId, todosSynced: 2, todosUpdated: 1, errors: [])
                },
                reconcileAccount: { accountId in
                    TodoReconcileResultDTO(accountId: accountId, added: 1, updated: 1, removed: 0, errors: [])
                },
                completeItem: { _ in fatalError("unused in render smoke") },
                reprioritizeItem: { _, _ in fatalError("unused in render smoke") },
                rescheduleItem: { _, _, _ in fatalError("unused in render smoke") },
                moveItem: { _, _ in fatalError("unused in render smoke") },
                emitInvalidation: { _ in }
            )
        )
        await store.load()

        assertRenders(
            NavigationStack {
                TodosView(store: store)
            }
            .environment(appModel)
        )
    }

    @Test("Calendar view renders with editable event detail")
    func rendersCalendarView() async {
        let appModel = FeaturePreviewFixtures.previewAppModel()
        appModel.connectionState = .connected
        appModel.sseConnected = true

        let store = CalendarStore(
            dependencies: .init(
                loadAccounts: {
                    [CalendarAccountDTO(
                        id: "calendar-acct-1",
                        connectionId: "conn-cal-1",
                        calendarEmail: "operator@example.com",
                        displayName: "Work",
                        timeZone: "Europe/Vienna",
                        syncCursorSyncToken: nil,
                        lastSyncAt: "2026-04-09T09:00:00Z",
                        eventCount: 2,
                        createdAt: "2026-04-01T08:00:00Z",
                        updatedAt: "2026-04-09T09:00:00Z"
                    )]
                },
                loadEvents: { _, _, _, _ in
                    [CalendarEventDTO(
                        id: "event-1",
                        accountId: "calendar-acct-1",
                        googleEventId: "google-event-1",
                        title: "Team standup",
                        description: "Daily planning",
                        location: "Zoom",
                        startTime: "2026-04-10T09:00:00.000Z",
                        endTime: "2026-04-10T10:00:00.000Z",
                        isAllDay: false,
                        status: "confirmed",
                        organizer: "operator@example.com",
                        attendees: ["annie@example.com"],
                        recurrenceRule: nil,
                        htmlLink: nil,
                        createdAtGoogle: "2026-04-01T08:00:00Z",
                        updatedAtGoogle: "2026-04-09T09:00:00Z",
                        createdAt: "2026-04-01T08:00:00Z",
                        updatedAt: "2026-04-09T09:00:00Z"
                    )]
                },
                loadEvent: { _ in
                    CalendarEventDTO(
                        id: "event-1",
                        accountId: "calendar-acct-1",
                        googleEventId: "google-event-1",
                        title: "Team standup",
                        description: "Daily planning",
                        location: "Zoom",
                        startTime: "2026-04-10T09:00:00.000Z",
                        endTime: "2026-04-10T10:00:00.000Z",
                        isAllDay: false,
                        status: "confirmed",
                        organizer: "operator@example.com",
                        attendees: ["annie@example.com"],
                        recurrenceRule: nil,
                        htmlLink: nil,
                        createdAtGoogle: "2026-04-01T08:00:00Z",
                        updatedAtGoogle: "2026-04-09T09:00:00Z",
                        createdAt: "2026-04-01T08:00:00Z",
                        updatedAt: "2026-04-09T09:00:00Z"
                    )
                },
                loadDigest: { _ in
                    CalendarDigestDTO(
                        id: "calendar-digest-1",
                        accountId: "calendar-acct-1",
                        workspaceId: "default",
                        date: "2026-04-09",
                        todayEventCount: 2,
                        upcomingCount: 4,
                        summaryMarkdown: "Two meetings today and four upcoming events this week.",
                        generatedAt: "2026-04-09T09:00:00Z"
                    )
                },
                syncAccount: { accountId in
                    CalendarSyncResultDTO(accountId: accountId, eventsSynced: 2, eventsUpdated: 1, errors: [])
                },
                createEvent: { _ in fatalError("unused in render smoke") },
                updateEvent: { _, _ in fatalError("unused in render smoke") },
                emitInvalidation: { _ in }
            )
        )
        await store.load()

        assertRenders(
            NavigationStack {
                CalendarView(store: store)
            }
            .environment(appModel)
        )
    }

    private func assertRenders<Content: View>(_ view: Content) {
        let hostingView = NSHostingView(rootView: view)
        hostingView.frame = NSRect(x: 0, y: 0, width: 900, height: 700)
        hostingView.layoutSubtreeIfNeeded()
        hostingView.displayIfNeeded()

        let imageRep = hostingView.bitmapImageRepForCachingDisplay(in: hostingView.bounds)
        #expect(imageRep != nil)

        withExtendedLifetime(hostingView) {}
    }
}
