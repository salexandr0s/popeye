import SwiftUI

enum SidebarController {
    @MainActor
    static func toggle() {
        NSApp.keyWindow?.firstResponder?.tryToPerform(#selector(NSSplitViewController.toggleSidebar(_:)), with: nil)
    }
}
