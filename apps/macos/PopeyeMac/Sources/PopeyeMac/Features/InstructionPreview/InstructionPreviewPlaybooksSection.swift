import SwiftUI
import PopeyeAPI

struct InstructionPreviewPlaybooksSection: View {
    let playbooks: [AppliedPlaybookDTO]

    var body: some View {
        InspectorSection(title: "Applied Playbooks") {
            ForEach(playbooks) { playbook in
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(playbook.title)
                        Text(playbook.id)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    Spacer()
                    StatusBadge(state: playbook.scope)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(playbook.title)
                .accessibilityValue("\(playbook.scope.replacingOccurrences(of: "_", with: " ").capitalized) scope, \(playbook.id)")
            }
        }
    }
}
