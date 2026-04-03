import SwiftUI
import PopeyeAPI

struct VaultStatusSection: View {
    let vaults: [VaultRecordDTO]
    let primaryVaultAvailable: Bool
    let isMutating: Bool
    let openVault: () -> Void
    let closeVault: () -> Void

    var body: some View {
        InspectorSection(title: "Vault") {
            if vaults.isEmpty {
                Text("No vault status is available yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(vaults) { vault in
                    DetailRow(
                        label: vault.kind.capitalized,
                        value: vault.status.replacingOccurrences(of: "_", with: " ").capitalized
                    )
                    DetailRow(label: "Encrypted", value: vault.encrypted ? "Yes" : "No")
                    if let keyRef = vault.encryptionKeyRef {
                        DetailRow(label: "Key Ref", value: keyRef)
                    }
                }

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        openVaultButton
                        closeVaultButton
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        openVaultButton
                        closeVaultButton
                    }
                }
            }
        }
    }

    private var openVaultButton: some View {
        Button("Open Vault", action: openVault)
            .buttonStyle(.borderedProminent)
            .disabled(primaryVaultAvailable == false || isMutating)
    }

    private var closeVaultButton: some View {
        Button("Close Vault", action: closeVault)
            .buttonStyle(.bordered)
            .disabled(primaryVaultAvailable == false || isMutating)
    }
}
