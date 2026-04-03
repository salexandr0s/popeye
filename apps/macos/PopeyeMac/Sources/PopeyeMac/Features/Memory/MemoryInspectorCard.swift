import SwiftUI

struct MemoryInspectorCard<Content: View>: View {
    let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: PopeyeUI.cardSpacing) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.background.secondary)
        .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
        .accessibilityElement(children: .contain)
    }
}
