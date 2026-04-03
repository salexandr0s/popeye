import SwiftUI
import PopeyeAPI

struct InstructionPreviewSourcesSection: View {
    let sources: [InstructionSourceDTO]

    var body: some View {
        InspectorSection(title: "Sources (by precedence)") {
            ForEach(sortedSources) { source in
                HStack(alignment: .top, spacing: 8) {
                    Text("P\(source.precedence)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(width: 32, alignment: .leading)
                    StatusBadge(state: source.type)
                    if let path = source.path {
                        Text(path)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(source.path ?? source.inlineId ?? source.type.replacingOccurrences(of: "_", with: " ").capitalized)
                .accessibilityValue("Precedence \(source.precedence), \(source.type.replacingOccurrences(of: "_", with: " "))")
            }
        }
    }

    private var sortedSources: [InstructionSourceDTO] {
        sources.sorted { $0.precedence < $1.precedence }
    }
}
