import SwiftUI

struct SetupCardDetailsSection: View {
    let rows: [SetupCardDetail]

    var body: some View {
        if rows.isEmpty == false {
            InspectorSection(title: "Details") {
                ForEach(rows) { row in
                    DetailRow(label: row.label, value: row.value)
                }
            }
        }
    }
}
