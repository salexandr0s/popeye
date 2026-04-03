import SwiftUI

struct SetupCardFollowUpSection: View {
    let rows: [SetupCardDetail]
    let footnote: String?

    var body: some View {
        if rows.isEmpty == false || footnote?.isEmpty == false {
            VStack(alignment: .leading, spacing: 12) {
                if rows.isEmpty == false {
                    InspectorSection(title: "Remaining Setup") {
                        ForEach(rows) { row in
                            DetailRow(label: row.label, value: row.value)
                        }
                    }
                }

                if let footnote, footnote.isEmpty == false {
                    Text(footnote)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        }
    }
}
