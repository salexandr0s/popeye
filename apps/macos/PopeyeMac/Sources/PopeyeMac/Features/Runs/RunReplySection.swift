import SwiftUI

struct RunReplySection: View {
    let reply: String

    var body: some View {
        InspectorSection(title: "Reply") {
            Text(reply)
                .font(.callout)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(.background)
                .clipShape(.rect(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(.separator, lineWidth: 0.5)
                )
        }
    }
}

#Preview {
    RunReplySection(reply: "The task was completed successfully. All tests pass.")
        .padding()
}
