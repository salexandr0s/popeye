import SwiftUI
import PopeyeAPI

struct InstructionPreviewView: View {
    @Bindable var store: InstructionPreviewStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            scopeBar
            Divider()
            contentArea
        }
        .navigationTitle("Instructions")
    }

    private var scopeBar: some View {
        HStack(spacing: 12) {
            TextField("Scope (e.g. default or default/project-1)", text: $store.scopeInput)
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    Task { await store.loadPreview() }
                }

            Button("Load") {
                Task { await store.loadPreview() }
            }
            .disabled(store.scopeInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isLoading)
        }
        .padding(12)
    }

    @ViewBuilder
    private var contentArea: some View {
        if store.isLoading {
            LoadingStateView(title: "Loading instructions...")
        } else if let error = store.error {
            VStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text(error)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let preview = store.preview {
            previewContent(preview)
        } else {
            EmptyStateView(
                icon: "doc.plaintext",
                title: "Instruction Preview",
                description: "Enter a scope and press Load to see the compiled instructions an agent receives."
            )
        }
    }

    private func previewContent(_ preview: InstructionPreviewDTO) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                metadataSection(preview)
                if !preview.warnings.isEmpty {
                    warningsSection(preview.warnings)
                }
                sourcesSection(preview.sources)
                compiledSection(preview.compiledText)
            }
            .padding(20)
        }
    }

    private func metadataSection(_ preview: InstructionPreviewDTO) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Bundle")
                    .font(.headline)
                Spacer()
                Text(IdentifierFormatting.formatShortID(preview.bundleHash))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            Text("\(preview.sources.count) source\(preview.sources.count == 1 ? "" : "s")")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func warningsSection(_ warnings: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Warnings")
                .font(.headline)
                .foregroundStyle(.orange)
            ForEach(warnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
    }

    private func sourcesSection(_ sources: [InstructionSourceDTO]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Sources (by precedence)")
                .font(.headline)
            let sortedSources = sources.sorted { $0.precedence < $1.precedence }
            ForEach(sortedSources) { source in
                HStack {
                    Text("P\(source.precedence)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(width: 30)
                    StatusBadge(state: source.type)
                    if let path = source.path {
                        Text(path)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                    Spacer()
                }
            }
        }
    }

    private func compiledSection(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Compiled Instructions")
                .font(.headline)
            Text(text)
                .font(.system(.body, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(.background.secondary)
                .clipShape(.rect(cornerRadius: 8))
        }
    }
}
