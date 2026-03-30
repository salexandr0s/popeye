import SwiftUI

@main
struct PopeyeMacApp: App {
    @State private var appModel = AppModel()
    private let routeShortcuts: [KeyEquivalent] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"]

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appModel)
        }
        .defaultSize(width: 1200, height: 800)
        .defaultPosition(.center)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(after: .sidebar) {
                ForEach(Array(AppRoute.allCases.enumerated()), id: \.element) { index, route in
                    if let shortcut = routeShortcuts[safe: index] {
                        Button(route.title) { appModel.selectedRoute = route }
                            .keyboardShortcut(shortcut, modifiers: .command)
                    } else {
                        Button(route.title) { appModel.selectedRoute = route }
                    }
                }
            }
        }

        Settings {
            SettingsView()
                .environment(appModel)
        }
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
