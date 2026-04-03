import SwiftUI
import PopeyeAPI

struct FinanceView: View {
    @Bindable var store: FinanceStore
    @State private var isPresentingImportSheet = false
    @State private var isPresentingTransactionSheet = false

    var body: some View {
        Group {
            if store.isLoading && store.imports.isEmpty && store.vaults.isEmpty {
                LoadingStateView(title: "Loading finance…")
            } else if let error = store.error, store.imports.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                HSplitView {
                    FinanceSidebar(store: store)
                        .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)
                    FinanceDetailPane(
                        store: store,
                        showImportSheet: { isPresentingImportSheet = true },
                        showTransactionSheet: { isPresentingTransactionSheet = true }
                    )
                    .frame(minWidth: 620)
                }
            }
        }
        .navigationTitle("Finance")
        .toolbar {
            ToolbarItemGroup {
                Button("New Import", systemImage: "square.and.arrow.down") {
                    isPresentingImportSheet = true
                }
                .disabled(store.vaults.isEmpty)

                Button("Add Transaction", systemImage: "plus.circle") {
                    isPresentingTransactionSheet = true
                }
                .disabled(store.activeImport == nil)
            }
        }
        .task {
            await store.load()
        }
        .onChange(of: store.selectedImportID) { _, _ in
            Task { await store.reloadSelection() }
        }
        .onChange(of: store.searchText) { _, newValue in
            if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Task { await store.search() }
            }
        }
        .popeyeRefreshable(invalidationSignals: [.general, .security]) {
            await store.load()
        }
        .sheet(isPresented: $isPresentingImportSheet) {
            FinanceImportSheet(vaults: store.vaults) { vaultId, importType, fileName in
                Task { await store.createImport(vaultId: vaultId, importType: importType, fileName: fileName) }
            }
        }
        .sheet(isPresented: $isPresentingTransactionSheet) {
            if let activeImport = store.activeImport {
                FinanceTransactionSheet(importId: activeImport.id) { input in
                    Task { await store.createTransaction(input: input) }
                }
            }
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
