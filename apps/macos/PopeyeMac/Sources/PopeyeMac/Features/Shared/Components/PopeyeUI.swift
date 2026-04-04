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

extension View {
    func popeyeSplitPane(
        minWidth: CGFloat? = nil,
        idealWidth: CGFloat? = nil,
        maxWidth: CGFloat? = nil
    ) -> some View {
        frame(
            minWidth: minWidth,
            idealWidth: idealWidth,
            maxWidth: maxWidth,
            maxHeight: .infinity,
            alignment: .topLeading
        )
    }
}
