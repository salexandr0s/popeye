import SwiftUI
import PopeyeAPI

struct MedicalImportSheet: View {
    let vaults: [VaultRecordDTO]
    let onSave: (String, String, String) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var vaultID: String
    @State private var importType = "pdf"
    @State private var fileName = ""

    init(vaults: [VaultRecordDTO], onSave: @escaping (String, String, String) -> Void) {
        self.vaults = vaults
        self.onSave = onSave
        _vaultID = State(initialValue: vaults.first?.id ?? "")
    }

    private var canSave: Bool {
        vaultID.isEmpty == false && fileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Create Medical Import")
                .font(.title3.bold())
                .padding(20)

            Form {
                Picker("Vault", selection: $vaultID) {
                    ForEach(vaults) { vault in
                        Text(vault.id).tag(vault.id)
                    }
                }

                Picker("Import Type", selection: $importType) {
                    Text("PDF").tag("pdf")
                    Text("Visit Summary").tag("visit_summary")
                    Text("Manual").tag("manual")
                }

                TextField("File Name", text: $fileName, prompt: Text("records.pdf"))
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Create Import") {
                    onSave(vaultID, importType, fileName.trimmingCharacters(in: .whitespacesAndNewlines))
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(canSave == false)
            }
            .padding(20)
        }
        .frame(width: 420, height: 240)
    }
}
