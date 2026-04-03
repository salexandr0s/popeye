import SwiftUI

struct ControlChangesEmptyState: View {
    var body: some View {
        ContentUnavailableView(
            "No Control Changes",
            systemImage: "slider.horizontal.3",
            description: Text("No recent control-plane changes")
        )
        .padding(.vertical, 12)
    }
}
