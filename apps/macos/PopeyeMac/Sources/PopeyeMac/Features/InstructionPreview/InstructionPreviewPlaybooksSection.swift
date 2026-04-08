import SwiftUI
import PopeyeAPI

struct InstructionPreviewPlaybooksSection: View {
    let playbooks: [AppliedPlaybookDTO]
    let openPlaybook: (AppliedPlaybookDTO) -> Void

    var body: some View {
        InspectorSection(title: "Applied Playbooks") {
            ForEach(playbooks) { playbook in
                Button {
                    openPlaybook(playbook)
                } label: {
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
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(playbook.title)
                .accessibilityValue("\(playbook.scope.replacingOccurrences(of: "_", with: " ").capitalized) scope, \(playbook.id)")
                .accessibilityHint("Opens the related playbook")
            }
        }
    }
}
