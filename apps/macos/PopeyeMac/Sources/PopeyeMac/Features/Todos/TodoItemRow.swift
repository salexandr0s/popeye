import SwiftUI
import PopeyeAPI

struct TodoItemRow: View {
    let item: TodoItemDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                Text(item.title)
                    .font(.headline)
                    .lineLimit(2)

                Spacer()

                StatusBadge(state: item.status)
            }

            if let projectName = item.projectName {
                Text(projectName)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let dueDate = item.dueDate {
                Text(dueDate)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(item.title)
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: String {
        [
            item.projectName,
            item.dueDate.map { "Due \($0)" },
            "Status \(item.status.replacingOccurrences(of: "_", with: " "))"
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
    }
}
