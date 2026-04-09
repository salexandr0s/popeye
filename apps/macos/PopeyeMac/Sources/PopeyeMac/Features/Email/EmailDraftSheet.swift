import SwiftUI

struct EmailDraftSheet: View {
    @Bindable var store: EmailStore

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(sheetTitle)
                .font(.title3.bold())
                .padding(20)

            Form {
                TextField("To (comma or newline separated)", text: toBinding, axis: .vertical)
                    .lineLimit(2...4)
                TextField("Cc (comma or newline separated)", text: ccBinding, axis: .vertical)
                    .lineLimit(2...4)
                TextField("Subject", text: subjectBinding)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Body")
                        .font(.subheadline.weight(.semibold))
                    TextEditor(text: bodyBinding)
                        .frame(minHeight: 220)
                        .overlay {
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(.quaternary, lineWidth: 1)
                        }
                }
                .padding(.vertical, 4)

                if let validation = store.draftValidationMessage {
                    Text(validation)
                        .foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) {
                    store.cancelDraftEditor()
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Button(primaryActionTitle) {
                    Task {
                        await store.saveDraft()
                        if store.editor == nil {
                            dismiss()
                        }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(!store.canSaveDraft)
            }
            .padding(20)
        }
        .frame(width: 560, height: 520)
    }

    private var sheetTitle: String {
        store.editor?.mode == .edit ? "Edit Draft" : "New Draft"
    }

    private var primaryActionTitle: String {
        store.editor?.mode == .edit ? "Save Draft" : "Create Draft"
    }

    private var toBinding: Binding<String> {
        Binding(
            get: { store.editor?.toText ?? "" },
            set: { store.editor?.toText = $0 }
        )
    }

    private var ccBinding: Binding<String> {
        Binding(
            get: { store.editor?.ccText ?? "" },
            set: { store.editor?.ccText = $0 }
        )
    }

    private var subjectBinding: Binding<String> {
        Binding(
            get: { store.editor?.subject ?? "" },
            set: { store.editor?.subject = $0 }
        )
    }

    private var bodyBinding: Binding<String> {
        Binding(
            get: { store.editor?.body ?? "" },
            set: { store.editor?.body = $0 }
        )
    }
}
