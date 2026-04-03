import SwiftUI
import PopeyeAPI

struct MedicalDocumentSheet: View {
    let importId: String
    let onSave: (MedicalDocumentCreateInput) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var fileName = ""
    @State private var mimeType = "application/pdf"
    @State private var sizeBytes = ""
    @State private var redactedSummary = ""

    private var parsedSizeBytes: Int? {
        Int(sizeBytes.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private var canSave: Bool {
        fileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false && parsedSizeBytes != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Add Document")
                .font(.title3.bold())
                .padding(20)

            Form {
                TextField("File Name", text: $fileName)
                TextField("MIME Type", text: $mimeType)
                TextField("Size (bytes)", text: $sizeBytes)
                TextField("Redacted Summary (optional)", text: $redactedSummary, axis: .vertical)
                    .lineLimit(3...5)
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Add Document") {
                    guard let parsedSizeBytes else { return }
                    onSave(MedicalDocumentCreateInput(
                        importId: importId,
                        fileName: fileName.trimmingCharacters(in: .whitespacesAndNewlines),
                        mimeType: mimeType.trimmingCharacters(in: .whitespacesAndNewlines),
                        sizeBytes: parsedSizeBytes,
                        redactedSummary: redactedSummary.trimmingCharacters(in: .whitespacesAndNewlines)
                    ))
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(canSave == false)
            }
            .padding(20)
        }
        .frame(width: 460, height: 280)
    }
}
