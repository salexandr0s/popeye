import SwiftUI

struct InstructionPreviewScopeBar: View {
    @Binding var displayMode: InstructionPreviewDisplayMode
    @Binding var scopeInput: String
    let workspaceName: String
    let isLoading: Bool
    let load: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            horizontalLayout
            verticalLayout
        }
        .padding(PopeyeUI.contentPadding)
    }

    private var horizontalLayout: some View {
        HStack(spacing: 12) {
            modePicker
            trailingContent
        }
    }

    private var verticalLayout: some View {
        VStack(alignment: .leading, spacing: 12) {
            modePicker
            trailingContent
        }
    }

    private var modePicker: some View {
        Picker("Mode", selection: $displayMode) {
            Text("Compiled").tag(InstructionPreviewDisplayMode.compiled)
            Text("Curated Docs").tag(InstructionPreviewDisplayMode.curated)
        }
        .pickerStyle(.segmented)
        .frame(width: 220)
    }

    @ViewBuilder
    private var trailingContent: some View {
        if displayMode == .compiled {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    scopeField
                    loadButton
                }

                VStack(alignment: .leading, spacing: 8) {
                    scopeField
                    loadButton
                }
            }
        } else {
            Text("Curated instruction documents for \(workspaceName)")
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var scopeField: some View {
        TextField("Scope (e.g. default or default/project-1)", text: $scopeInput)
            .textFieldStyle(.roundedBorder)
            .onSubmit(load)
    }

    private var loadButton: some View {
        Button("Load", action: load)
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .disabled(scopeInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading)
            .help("Load the compiled instruction preview for the current scope")
    }
}
