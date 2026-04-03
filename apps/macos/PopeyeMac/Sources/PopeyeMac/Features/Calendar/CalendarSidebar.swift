import SwiftUI
import PopeyeAPI

struct CalendarSidebar: View {
    @Binding var selectedAccountID: String?
    @Binding var selectedEventID: String?
    let accounts: [CalendarAccountDTO]
    let events: [CalendarEventDTO]

    private var selectedAccount: CalendarAccountDTO? {
        accounts.first { $0.id == selectedAccountID } ?? accounts.first
    }

    var body: some View {
        VStack(spacing: 0) {
            CalendarSidebarHeader(
                selectedAccountID: $selectedAccountID,
                accounts: accounts,
                selectedAccount: selectedAccount
            )

            Divider()

            if events.isEmpty {
                EmptyStateView(
                    icon: "calendar",
                    title: "No upcoming events",
                    description: "Events will appear here once Calendar is connected."
                )
            } else {
                List(events, selection: $selectedEventID) { event in
                    CalendarEventRow(event: event)
                        .tag(event.id)
                }
                .listStyle(.sidebar)
            }
        }
    }
}
