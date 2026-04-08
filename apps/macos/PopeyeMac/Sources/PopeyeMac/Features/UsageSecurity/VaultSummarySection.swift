import SwiftUI
import PopeyeAPI

struct VaultSummarySection: View {
    let vaults: [VaultRecordDTO]
    let phase: ScreenOperationPhase
    let retry: () -> Void

    private var openCount: Int {
        vaults.count(where: { $0.status == "open" })
    }

    private var restrictedCount: Int {
        vaults.count(where: { $0.kind == "restricted" })
    }

    private var encryptedCount: Int {
        vaults.count(where: \.encrypted)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Vaults")
                    .font(.title3.weight(.semibold))
                Text("Summary-only visibility into capability and restricted vault state. Sensitive vault operations stay in the CLI, web inspector, or domain-specific flows.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            OperationStatusView(
                phase: phase,
                loadingTitle: "Loading vault summary…",
                failureTitle: "Couldn’t load vault summary",
                retryAction: retry
            )

            if !vaults.isEmpty {
                LazyVGrid(columns: PopeyeUI.cardColumns(minimum: 160, maximum: 240), spacing: PopeyeUI.cardSpacing) {
                    DashboardCard(label: "Total Vaults", value: "\(vaults.count)")
                    DashboardCard(label: "Open", value: "\(openCount)", valueColor: openCount > 0 ? .orange : .secondary)
                    DashboardCard(label: "Restricted", value: "\(restrictedCount)")
                    DashboardCard(label: "Encrypted", value: "\(encryptedCount)", valueColor: encryptedCount > 0 ? .green : .secondary)
                }

                VStack(alignment: .leading, spacing: 12) {
                    ForEach(vaults) { vault in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(vault.domain.humanizedForPolicyUI) • \(vault.kind.humanizedForPolicyUI)")
                                        .font(.headline)
                                    Text(vault.id)
                                        .font(.callout.monospaced())
                                        .foregroundStyle(.secondary)
                                }

                                Spacer()

                                StatusBadge(state: vault.status)
                            }

                            LazyVGrid(columns: PopeyeUI.cardColumns(minimum: 180, maximum: 280), spacing: 8) {
                                vaultCell(label: "Encrypted", value: vault.encrypted ? "Yes" : "No")
                                vaultCell(label: "Key Ref", value: vault.encryptionKeyRef ?? "—")
                                vaultCell(label: "Created", value: DateFormatting.formatAbsoluteTime(vault.createdAt))
                                vaultCell(label: "Last Accessed", value: formattedOptionalTimestamp(vault.lastAccessedAt))
                                vaultCell(label: "Runtime Path", value: vault.dbPath)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(PopeyeUI.contentPadding)
                        .background(.background)
                        .clipShape(.rect(cornerRadius: PopeyeUI.cardCornerRadius))
                        .overlay {
                            RoundedRectangle(cornerRadius: PopeyeUI.cardCornerRadius)
                                .strokeBorder(.separator, lineWidth: 0.5)
                        }
                    }
                }
            } else if !phase.isLoading {
                EmptyStateView(
                    icon: "lock.shield",
                    title: "No vaults",
                    description: "Vault records will appear here once capability or restricted stores exist."
                )
            }
        }
    }
}

private func vaultCell(label: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(label)
            .font(.caption)
            .foregroundStyle(.secondary)
        Text(value)
            .font(.callout)
            .foregroundStyle(label == "Runtime Path" ? .secondary : .primary)
            .textSelection(.enabled)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(10)
    .background(.background.secondary)
    .clipShape(.rect(cornerRadius: 10))
}

private func formattedOptionalTimestamp(_ value: String?) -> String {
    guard let value, value.isEmpty == false else { return "—" }
    return DateFormatting.formatAbsoluteTime(value)
}
