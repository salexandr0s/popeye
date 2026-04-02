import SwiftUI
import PopeyeAPI

struct CalendarView: View {
    @Bindable var store: CalendarStore
    @Environment(AppModel.self) private var appModel
    @State private var debouncer = ReloadDebouncer()

    var body: some View {
        Group {
            if store.isLoading && store.accounts.isEmpty {
                LoadingStateView(title: "Loading calendar…")
            } else if let error = store.error, store.accounts.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                HSplitView {
                    sidebar
                        .frame(minWidth: 300, idealWidth: 340, maxWidth: 380)
                    detail
                        .frame(minWidth: 520)
                }
            }
        }
        .navigationTitle("Calendar")
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onChange(of: store.selectedEventID) { _, newValue in
            guard let newValue else { return }
            Task { await store.loadEvent(id: newValue) }
        }
        .onChange(of: store.selectedAccountID) { oldValue, newValue in
            guard oldValue != newValue, oldValue != nil else { return }
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.connections, .general].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Calendar", selection: $store.selectedAccountID) {
                    ForEach(store.accounts) { account in
                        Text(account.displayName).tag(Optional(account.id))
                    }
                }
                .pickerStyle(.menu)
                if let account = store.accounts.first(where: { $0.id == store.selectedAccountID }) {
                    Text(account.calendarEmail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(16)

            Divider()

            if store.events.isEmpty {
                EmptyStateView(icon: "calendar", title: "No upcoming events", description: "Events will appear here once Calendar is connected.")
            } else {
                List(store.events, selection: $store.selectedEventID) { event in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(event.title)
                            .font(.headline)
                            .lineLimit(1)
                        Text(DateFormatting.formatAbsoluteTime(event.startTime))
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        if event.location.isEmpty == false {
                            Text(event.location)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .padding(.vertical, 4)
                    .tag(event.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private var detail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let digest = store.digest {
                    InspectorSection(title: "Agenda Summary") {
                        DetailRow(label: "Today", value: "\(digest.todayEventCount)")
                        DetailRow(label: "Upcoming", value: "\(digest.upcomingCount)")
                        Text(digest.summaryMarkdown)
                            .foregroundStyle(.secondary)
                    }
                }

                if let event = store.selectedEvent {
                    InspectorSection(title: event.title) {
                        DetailRow(label: "Start", value: DateFormatting.formatAbsoluteTime(event.startTime))
                        DetailRow(label: "End", value: DateFormatting.formatAbsoluteTime(event.endTime))
                        DetailRow(label: "Organizer", value: event.organizer.isEmpty ? "Unknown" : event.organizer)
                        DetailRow(label: "Status", value: event.status.capitalized)
                        if event.location.isEmpty == false {
                            DetailRow(label: "Location", value: event.location)
                        }
                        if event.description.isEmpty == false {
                            Text(event.description)
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    ContentUnavailableView("Select an event", systemImage: "calendar.badge.clock")
                        .frame(maxWidth: .infinity, minHeight: 320)
                }
            }
            .padding(20)
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
