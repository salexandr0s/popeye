import SwiftUI

struct AutomationAttentionSection: View {
    let reason: String?

    var body: some View {
        InspectorSection(title: "Why won't this run?") {
            if let reason {
                Label(reason, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            } else {
                Text("No blocking signal is visible right now.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
