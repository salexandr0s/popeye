import SwiftUI
import PopeyeAPI

struct EmailSidebar: View {
    @Binding var selectedAccountID: String?
    @Binding var selectedThreadID: String?
    let accounts: [EmailAccountDTO]
    let activeAccount: EmailAccountDTO?
    let threads: [EmailThreadDTO]
    let searchResults: [EmailSearchResultDTO]
    let activeSearchQuery: String?
    let searchError: APIError?
    let isSearching: Bool

    var body: some View {
        VStack(spacing: 0) {
            EmailSidebarHeader(
                selectedAccountID: $selectedAccountID,
                accounts: accounts,
                activeAccount: activeAccount,
                activeSearchQuery: activeSearchQuery,
                searchResultCount: searchResults.count,
                isSearching: isSearching,
                searchError: searchError
            )

            Divider()

            Group {
                if let query = activeSearchQuery {
                    searchContent(query: query)
                } else if threads.isEmpty {
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

    @ViewBuilder
    private func searchContent(query: String) -> some View {
        if isSearching && searchResults.isEmpty {
            VStack(spacing: 12) {
                ProgressView()
                Text("Searching \"\(query)\"…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding()
        } else if searchResults.isEmpty {
            if let searchError {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Search failed")
                        .font(.headline)
                    Text(searchError.userMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(PopeyeUI.contentPadding)
            } else {
                EmptyStateView(
                    icon: "magnifyingglass",
                    title: "No matches",
                    description: "No messages matched \"\(query)\" in the selected mailbox."
                )
            }
        } else {
            List(searchResults, selection: $selectedThreadID) { result in
                EmailSearchResultRow(result: result)
                    .tag(result.threadId)
            }
            .listStyle(.sidebar)
        }
    }
}
