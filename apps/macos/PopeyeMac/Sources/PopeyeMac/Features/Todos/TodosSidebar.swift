import SwiftUI
import PopeyeAPI

struct TodosSidebar: View {
    @Binding var selectedAccountID: String?
    @Binding var selectedProjectName: String?
    @Binding var selectedItemID: String?
    let accounts: [TodoAccountDTO]
    let projects: [TodoProjectDTO]
    let items: [TodoItemDTO]

    var body: some View {
        VStack(spacing: 0) {
            TodosSidebarHeader(
                selectedAccountID: $selectedAccountID,
                selectedProjectName: $selectedProjectName,
                accounts: accounts,
                projects: projects
            )

            Divider()

            if items.isEmpty {
                EmptyStateView(
                    icon: "checklist",
                    title: "No todo items",
                    description: "Todo items will appear here once an account is available."
                )
            } else {
                List(items, selection: $selectedItemID) { item in
                    TodoItemRow(item: item)
                        .tag(item.id)
                }
                .listStyle(.sidebar)
            }
        }
    }
}
