import SwiftUI
import PopeyeAPI

struct MemoryInspectorContentSection: View {
    let memory: MemoryRecordDTO
    @Binding var showContent: Bool

    var body: some View {
        InspectorSection(title: "Content") {
            DisclosureGroup(isExpanded: $showContent) {
                MemoryInspectorCard {
                    Text(memory.content)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.top, 8)
            } label: {
                Text("Show full content")
            }
            .accessibilityHint("Expands the stored memory content")
        }
    }
}
