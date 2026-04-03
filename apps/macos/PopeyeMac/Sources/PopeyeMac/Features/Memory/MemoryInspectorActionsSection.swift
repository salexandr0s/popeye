import SwiftUI

struct MemoryInspectorActionsSection: View {
    let isMutating: Bool
    let onPin: () -> Void
    let onForget: () -> Void

    var body: some View {
        InspectorSection(title: "Actions") {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    actionControls
                }

                VStack(alignment: .leading, spacing: 8) {
                    actionControls
                }
            }
            .disabled(isMutating)
        }
    }

    private var actionControls: some View {
        Group {
            Button("Pin", systemImage: "pin.fill", action: onPin)
                .buttonStyle(.borderedProminent)
                .help("Protect this memory from consolidation and confidence decay")

            Button("Forget", systemImage: "trash", role: .destructive, action: onForget)
                .buttonStyle(.bordered)
                .help("Exclude this memory from retrieval")

            if isMutating {
                ProgressView()
                    .controlSize(.small)
            }
        }
    }
}
