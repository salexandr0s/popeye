import SwiftUI

@main
struct PopeyeMacApp: App {
    @State private var appModel = AppModel()
    private let primaryRouteCommands: [(route: AppRoute, shortcut: KeyEquivalent)] = [
        (.home, "1"),
        (.setup, "2"),
        (.brain, "3"),
        (.automations, "4"),
        (.memory, "5"),
        (.commandCenter, "6"),
        (.runs, "7"),
        (.receipts, "8"),
        (.usageSecurity, "9"),
    ]
    private let secondaryRouteGroups: [RouteGroup] = [
        .overview,
        .setup,
        .brain,
        .automations,
        .life,
        .privateDomains,
        .system,
    ]

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appModel)
                .onAppear {
                    PopeyeBranding.installAppIcon()
                }
        }
        .defaultSize(width: 1200, height: 800)
        .defaultPosition(.center)
        .windowResizability(.contentMinSize)
        .windowToolbarStyle(.unified)
        .commands {
            SidebarCommands()

            CommandMenu("Navigate") {
                Section("Primary") {
                    ForEach(primaryRouteCommands, id: \.route) { command in
                        Button(command.route.title) {
                            appModel.selectedRoute = command.route
                        }
                        .keyboardShortcut(command.shortcut, modifiers: .command)
                    }
                }

                Divider()

                ForEach(secondaryRouteGroups, id: \.self) { group in
                    Menu(group.title) {
                        ForEach(group.routes.filter { route in
                            primaryRouteCommands.contains(where: { $0.route == route }) == false
                        }) { route in
                            Button(route.title) {
                                appModel.selectedRoute = route
                            }
                        }
                    }
                }
            }

            CommandGroup(after: .toolbar) {
                Button("Refresh Current View", action: refreshCurrentView)
                    .keyboardShortcut("r", modifiers: .command)

                Button("Toggle Sidebar", action: SidebarController.toggle)
                    .keyboardShortcut("s", modifiers: [.command, .control])
            }
        }

        Settings {
            SettingsView()
                .environment(appModel)
        }
    }

    private func refreshCurrentView() {
        NotificationCenter.default.post(name: .popeyeRefresh, object: nil)
    }
}
