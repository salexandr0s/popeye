import SwiftUI

struct LoadingStateView: View {
    var title: String = "Loading…"

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(title)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    LoadingStateView(title: "Loading dashboard…")
}
