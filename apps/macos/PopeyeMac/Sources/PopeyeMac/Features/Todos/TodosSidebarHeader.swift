import SwiftUI
import PopeyeAPI

struct TodosSidebarHeader: View {
    @Binding var selectedAccountID: String?
    @Binding var selectedProjectName: String?
    let accounts: [TodoAccountDTO]
    let projects: [TodoProjectDTO]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Account", selection: $selectedAccountID) {
                ForEach(accounts) { account in
                    Text(account.displayName).tag(Optional(account.id))
                }
            }
            .pickerStyle(.menu)
            .disabled(accounts.isEmpty)

            Picker("Project", selection: $selectedProjectName) {
                Text("All Projects").tag(Optional<String>.none)
                ForEach(projects) { project in
                    Text(project.name).tag(Optional(project.name))
                }
            }
            .pickerStyle(.menu)
            .disabled(selectedAccountID == nil)
        }
        .padding(PopeyeUI.contentPadding)
    }
}
