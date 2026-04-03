import SwiftUI
import PopeyeAPI

struct ErrorStateView: View {
    let error: APIError
    let retryAction: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Something went wrong", systemImage: "exclamationmark.triangle")
                .foregroundStyle(.red)
        } description: {
            Text(error.userMessage)
        } actions: {
            Button("Retry", action: retryAction)
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    ErrorStateView(error: .transportUnavailable, retryAction: {})
}
