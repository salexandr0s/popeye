import SwiftUI
import AppKit

enum PopeyeBranding {
    private static let logoName = "popeye_logo"
    private static let logoExtension = "png"

    static let logoImage: NSImage? = {
        guard let url = Bundle.module.url(forResource: logoName, withExtension: logoExtension) else {
            return nil
        }
        return NSImage(contentsOf: url)
    }()

    @MainActor
    static func installAppIcon() {
        guard let logoImage else { return }
        NSApplication.shared.applicationIconImage = logoImage
    }
}
