import SwiftUI

struct SetupChecklistHeader: View {
    let workspaceName: String
    let completedCount: Int
    let totalCount: Int
    let summary: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Setup Checklist")
                .font(.title3.bold())

            Text(workspaceName)
                .font(.callout)
                .foregroundStyle(.secondary)

            Text("\(completedCount) of \(totalCount) ready")
                .font(.callout)
                .foregroundStyle(.secondary)

            ProgressView(value: Double(completedCount), total: Double(totalCount))

            Text(summary)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PopeyeUI.contentPadding)
        .background(.background.secondary)
    }
}
