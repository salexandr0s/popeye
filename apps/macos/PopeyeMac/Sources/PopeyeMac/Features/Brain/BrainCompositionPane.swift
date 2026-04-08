import SwiftUI
import PopeyeAPI

struct BrainCompositionPane: View {
    let snapshot: BrainSnapshot
    let openInstructions: () -> Void
    let openPlaybook: (AppliedPlaybookDTO) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
            HStack {
                Text("Instruction Composition")
                    .font(.title2.bold())
                Spacer()
                Button("Open Full Preview", action: openInstructions)
                    .buttonStyle(.borderedProminent)
            }

            if !snapshot.playbooks.isEmpty {
                InspectorSection(title: "Applied Playbooks") {
                    ForEach(snapshot.playbooks) { playbook in
                        Button {
                            openPlaybook(playbook)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(playbook.title)
                                    Text(playbook.id)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
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

            InspectorSection(title: "Sources by Type") {
                if snapshot.sourceGroups.isEmpty {
                    Text("No instruction sources are loaded.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(snapshot.sourceGroups) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(group.type.replacingOccurrences(of: "_", with: " ").capitalized)
                                Spacer()
                                Text("\(group.sources.count)")
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(group.sources) { source in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        StatusBadge(state: "P\(source.precedence)")
                                        if let path = source.path {
                                            Text(path)
                                                .foregroundStyle(.secondary)
                                        } else if let inlineID = source.inlineId {
                                            Text(inlineID)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Text(source.content)
                                        .lineLimit(3)
                                        .foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 4)
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel(source.path ?? source.inlineId ?? group.type.replacingOccurrences(of: "_", with: " ").capitalized)
                                .accessibilityValue("Precedence \(source.precedence), \(group.type.replacingOccurrences(of: "_", with: " "))")
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PopeyeUI.contentPadding)
    }
}
