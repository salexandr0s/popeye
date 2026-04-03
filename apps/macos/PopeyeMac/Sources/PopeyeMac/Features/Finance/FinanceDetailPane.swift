import SwiftUI
import PopeyeAPI

struct FinanceDetailPane: View {
    @Bindable var store: FinanceStore
    let showImportSheet: () -> Void
    let showTransactionSheet: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                mutationBanner
                VaultStatusSection(
                    vaults: store.vaults,
                    primaryVaultAvailable: store.primaryVault != nil,
                    isMutating: store.isMutating,
                    openVault: { Task { await store.openVault() } },
                    closeVault: { Task { await store.closeVault() } }
                )
                FinanceOverviewSection(digest: store.digest)
                FinanceSearchSection(
                    searchText: $store.searchText,
                    searchResults: store.searchResults,
                    search: { Task { await store.search() } }
                )
                FinanceAnomalyFlagsSection(digest: store.digest)
                FinanceQuickActionsSection(
                    isMutating: store.isMutating,
                    hasVaults: store.vaults.isEmpty == false,
                    hasActiveImport: store.activeImport != nil,
                    regenerateDigest: { Task { await store.triggerDigest() } },
                    createImport: showImportSheet,
                    addTransaction: showTransactionSheet
                )
                FinanceSelectedImportSection(
                    activeImport: store.activeImport,
                    isMutating: store.isMutating,
                    updateStatus: { status in
                        Task { await store.updateImportStatus(status) }
                    }
                )
                FinanceTransactionsSection(transactions: store.transactions)
                FinanceDocumentsSection(documents: store.documents)
            }
            .padding(PopeyeUI.contentPadding)
        }
    }

    @ViewBuilder
    private var mutationBanner: some View {
        if let message = store.mutationMessage {
            Label(message, systemImage: "checkmark.circle.fill")
                .font(.callout)
                .foregroundStyle(.green)
        } else if let message = store.mutationErrorMessage {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(.orange)
        }
    }
}
