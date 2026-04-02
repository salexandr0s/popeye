import SwiftUI
import PopeyeAPI

struct FinanceImportSheet: View {
    let vaults: [VaultRecordDTO]
    let onSave: (String, String, String) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var vaultID: String
    @State private var importType = "csv"
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
            Text("Create Finance Import")
                .font(.title3.bold())
                .padding(20)

            Form {
                Picker("Vault", selection: $vaultID) {
                    ForEach(vaults) { vault in
                        Text(vault.id).tag(vault.id)
                    }
                }

                Picker("Import Type", selection: $importType) {
                    Text("CSV").tag("csv")
                    Text("OFX").tag("ofx")
                    Text("Manual").tag("manual")
                }

                TextField("File Name", text: $fileName, prompt: Text("statement.csv"))
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Create Import") {
                    onSave(vaultID, importType, fileName.trimmingCharacters(in: .whitespacesAndNewlines))
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(canSave == false)
            }
            .padding(20)
        }
        .frame(width: 420, height: 240)
    }
}
