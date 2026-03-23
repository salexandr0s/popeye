import SwiftUI

struct PlaceholderView: View {
    let route: AppRoute

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: route.systemImage)
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text(route.title)
                .font(.title2)
            Text("Coming soon")
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle(route.title)
    }
}

#Preview {
    PlaceholderView(route: .dashboard)
}
