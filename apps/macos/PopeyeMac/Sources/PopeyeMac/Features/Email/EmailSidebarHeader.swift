import SwiftUI
import PopeyeAPI

struct EmailSidebarHeader: View {
    @Binding var selectedAccountID: String?
    let accounts: [EmailAccountDTO]
    let activeAccount: EmailAccountDTO?

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
        }
        .padding(PopeyeUI.contentPadding)
    }
}
