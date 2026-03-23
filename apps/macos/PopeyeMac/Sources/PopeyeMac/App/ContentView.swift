import SwiftUI

struct ContentView: View {
    @Environment(AppModel.self) private var appModel

    var body: some View {
        Group {
            if appModel.isConnected {
                AppShellView()
            } else {
                ConnectView()
            }
        }
        .task {
            await appModel.restoreSession()
        }
    }
}

#Preview {
    ContentView()
        .environment(AppModel())
}
