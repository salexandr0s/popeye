import SwiftUI

struct EmptyStateView: View {
    let icon: String
    let title: String
    var description: String?

    var body: some View {
        if let description {
            ContentUnavailableView(title, systemImage: icon, description: Text(description))
        } else {
            ContentUnavailableView(title, systemImage: icon)
        }
    }
}

#Preview {
    EmptyStateView(icon: "tray", title: "No runs yet", description: "Runs will appear here when the daemon starts processing tasks.")
}
