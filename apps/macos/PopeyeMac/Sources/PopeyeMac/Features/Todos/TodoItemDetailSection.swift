import SwiftUI
import PopeyeAPI

struct TodoItemDetailSection: View {
    let item: TodoItemDTO

    var body: some View {
        InspectorSection(title: item.title) {
            DetailRow(label: "Priority", value: "P\(item.priority)")
            DetailRow(label: "Status", value: item.status.capitalized)
            DetailRow(label: "Project", value: item.projectName ?? "None")
            DetailRow(label: "Due", value: dueSummary)

            if let completedAt = item.completedAt {
                DetailRow(label: "Completed", value: completedAt)
            }

            if item.description.isEmpty == false {
                Text(item.description)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
    }

    private var dueSummary: String {
        switch (item.dueDate, item.dueTime) {
        case let (.some(date), .some(time)):
            "\(date) \(time)"
        case let (.some(date), .none):
            date
        default:
            "Unscheduled"
        }
    }
}
