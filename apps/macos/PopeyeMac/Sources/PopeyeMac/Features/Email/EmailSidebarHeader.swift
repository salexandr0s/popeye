import SwiftUI
import PopeyeAPI

struct EmailSidebarHeader: View {
    @Binding var selectedAccountID: String?
    let accounts: [EmailAccountDTO]
    let activeAccount: EmailAccountDTO?
    let activeSearchQuery: String?
    let searchResultCount: Int
    let isSearching: Bool
    let searchError: APIError?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Account", selection: $selectedAccountID) {
                ForEach(accounts) { account in
                    Text(account.displayName).tag(Optional(account.id))
                }
            }
            .pickerStyle(.menu)
            .disabled(accounts.isEmpty)

            if let activeAccount {
                Text(activeAccount.emailAddress)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let activeSearchQuery {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Results for \"\(activeSearchQuery)\"")
                        .font(.footnote.weight(.semibold))
                    if isSearching {
                        Text("Searching mailbox…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("\(searchResultCount) match\(searchResultCount == 1 ? "" : "es")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else if let searchError {
                Text(searchError.userMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(PopeyeUI.contentPadding)
    }
}
