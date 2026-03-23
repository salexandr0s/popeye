import SwiftUI

struct AppToolbar: ToolbarContent {
    @Environment(AppModel.self) private var appModel

    var body: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button("Refresh", systemImage: "arrow.clockwise", action: refresh)
                .keyboardShortcut("r", modifiers: .command)
                .help("Refresh current view")
        }

        ToolbarItem(placement: .status) {
            ConnectionIndicator(state: appModel.connectionState, sseConnected: appModel.sseConnected)
        }
    }

    private func refresh() {
        NotificationCenter.default.post(name: .popeyeRefresh, object: nil)
    }
}
