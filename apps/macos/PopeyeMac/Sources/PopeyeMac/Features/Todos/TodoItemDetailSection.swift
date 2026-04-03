import SwiftUI
import PopeyeAPI

struct TodoItemDetailSection: View {
    let item: TodoItemDTO

    var body: some View {
        InspectorSection(title: item.title) {
            DetailRow(label: "Priority", value: "P\(item.priority)")
            DetailRow(label: "Status", value: item.status.capitalized)
            DetailRow(label: "Project", value: item.projectName ?? "None")
            DetailRow(label: "Due", value: item.dueDate ?? "Unscheduled")

            if item.description.isEmpty == false {
                Text(item.description)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
    }
}
