import SwiftUI

struct AppToolbar: ToolbarContent {
    @Environment(AppModel.self) private var appModel

    var body: some ToolbarContent {
        @Bindable var workspace = appModel.workspace

        ToolbarItem(placement: .automatic) {
            if appModel.isConnected {
                Picker("Workspace", selection: $workspace.selectedWorkspaceID) {
                    if appModel.workspaces.isEmpty {
                        Text("Default").tag("default")
                    } else {
                        ForEach(appModel.workspaces) { workspace in
                            Text(workspace.name).tag(workspace.id)
                        }
                    }
                }
                .pickerStyle(.menu)
                .frame(minWidth: 180)
                .help("Current workspace")
            }
        }

        ToolbarItem(placement: .primaryAction) {
            Button("Refresh Current View", systemImage: "arrow.clockwise", action: refresh)
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
