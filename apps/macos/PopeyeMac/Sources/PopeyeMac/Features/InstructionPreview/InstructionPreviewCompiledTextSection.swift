import SwiftUI

struct InstructionPreviewCompiledTextSection: View {
    let text: String

    var body: some View {
        InspectorSection(title: "Compiled Instructions") {
            Text(text)
                .font(.system(.body, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(.background.secondary)
                .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
        }
    }
}
