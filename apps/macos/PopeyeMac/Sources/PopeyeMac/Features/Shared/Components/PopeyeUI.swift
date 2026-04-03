import SwiftUI

enum PopeyeUI {
    static let sectionSpacing: CGFloat = 20
    static let contentPadding: CGFloat = 20
    static let cardSpacing: CGFloat = 12
    static let cardCornerRadius: CGFloat = 12
    static let splitColumnSpacing: CGFloat = 16

    static func cardColumns(minimum: CGFloat = 220, maximum: CGFloat = 320) -> [GridItem] {
        [
            GridItem(
                .adaptive(minimum: minimum, maximum: maximum),
                spacing: cardSpacing,
                alignment: .top
            ),
        ]
    }
}
