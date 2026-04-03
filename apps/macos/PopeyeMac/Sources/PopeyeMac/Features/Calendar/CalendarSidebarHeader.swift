import SwiftUI
import PopeyeAPI

struct CalendarSidebarHeader: View {
    @Binding var selectedAccountID: String?
    let accounts: [CalendarAccountDTO]
    let selectedAccount: CalendarAccountDTO?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Calendar", selection: $selectedAccountID) {
                ForEach(accounts) { account in
                    Text(account.displayName).tag(Optional(account.id))
                }
            }
            .pickerStyle(.menu)
            .disabled(accounts.isEmpty)

            if let selectedAccount {
                Text(selectedAccount.calendarEmail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(PopeyeUI.contentPadding)
    }
}
