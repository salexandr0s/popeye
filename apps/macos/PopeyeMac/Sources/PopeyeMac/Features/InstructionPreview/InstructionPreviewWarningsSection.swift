import SwiftUI

struct InstructionPreviewWarningsSection: View {
    let warnings: [String]

    var body: some View {
        InspectorSection(title: "Warnings") {
            ForEach(warnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.orange)
            }
        }
    }
}
