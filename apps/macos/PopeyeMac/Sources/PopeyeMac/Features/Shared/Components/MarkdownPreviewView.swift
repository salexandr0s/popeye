import SwiftUI

struct MarkdownPreviewView: View {
    let markdown: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let rendered = renderedMarkdown {
                    Text(rendered)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(markdown)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .textSelection(.enabled)
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(.background)
    }

    private var renderedMarkdown: AttributedString? {
        guard markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else { return nil }
        return try? AttributedString(markdown: markdown)
    }
}
