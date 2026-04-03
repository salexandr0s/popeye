import SwiftUI

struct InspectorSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)
            content
        }
        .accessibilityElement(children: .contain)
    }
}

#Preview {
    InspectorSection(title: "Details") {
        Text("Sample content")
    }
    .padding()
}
