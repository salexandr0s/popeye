import SwiftUI
import PopeyeAPI

struct EmailSidebar: View {
    @Binding var selectedAccountID: String?
    @Binding var selectedThreadID: String?
    let accounts: [EmailAccountDTO]
    let activeAccount: EmailAccountDTO?
    let threads: [EmailThreadDTO]

    var body: some View {
        VStack(spacing: 0) {
            EmailSidebarHeader(
                selectedAccountID: $selectedAccountID,
                accounts: accounts,
                activeAccount: activeAccount
            )

            Divider()

            if threads.isEmpty {
                EmptyStateView(
                    icon: "envelope",
                    title: "No threads yet",
                    description: "Connect Gmail in Setup to start browsing mail."
                )
            } else {
                List(threads, selection: $selectedThreadID) { thread in
                    EmailThreadRow(thread: thread)
                        .tag(thread.id)
                }
                .listStyle(.sidebar)
            }
        }
    }
}
