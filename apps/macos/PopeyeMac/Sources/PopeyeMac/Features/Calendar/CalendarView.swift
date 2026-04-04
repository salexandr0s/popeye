import SwiftUI
import PopeyeAPI

struct CalendarView: View {
    @Bindable var store: CalendarStore
    @Environment(AppModel.self) private var appModel

    var body: some View {
        rootContent
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
        .popeyeRefreshable(invalidationSignals: [.connections, .general]) {
            await store.load()
        }
    }

    @ViewBuilder
    private var rootContent: some View {
        if store.isLoading && store.accounts.isEmpty {
            LoadingStateView(title: "Loading calendar…")
        } else if let error = store.error, store.accounts.isEmpty {
            ErrorStateView(error: error, retryAction: reload)
        } else {
            HSplitView {
                CalendarSidebar(
                    selectedAccountID: $store.selectedAccountID,
                    selectedEventID: $store.selectedEventID,
                    accounts: store.accounts,
                    events: store.events
                )
                .popeyeSplitPane(minWidth: 300, idealWidth: 340, maxWidth: 380)

                detail
                    .popeyeSplitPane(minWidth: 520)
            }
        }
    }

    private var detail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                if let digest = store.digest {
                    CalendarDigestSection(digest: digest)
                }

                if let event = store.selectedEvent {
                    CalendarEventDetailSection(event: event)
                } else {
                    ContentUnavailableView("Select an event", systemImage: "calendar.badge.clock")
                        .frame(maxWidth: .infinity, minHeight: 320)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PopeyeUI.contentPadding)
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
