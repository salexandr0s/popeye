import SwiftUI
import PopeyeAPI

struct ReceiptsView: View {
    @Bindable var store: ReceiptsStore

    var body: some View {
        Group {
            if store.isLoading && store.receipts.isEmpty {
                LoadingStateView(title: "Loading receipts...")
            } else if store.receipts.isEmpty {
                EmptyStateView(
                    icon: "doc.text",
                    title: "No receipts yet",
                    description: "Receipts are generated after each run completes."
                )
            } else {
                receiptsContent
            }
        }
        .navigationTitle("Receipts")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Filter receipts…")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Picker("Status", selection: $store.statusFilter) {
                    Text("All Statuses").tag(String?.none)
                    Divider()
                    ForEach(store.availableStatuses, id: \.self) { status in
                        Text(status.replacing("_", with: " ").capitalized)
                            .tag(Optional(status))
                    }
                }
                .frame(width: 140)
            }
        }
        .task {
            await store.load()
        }
        .popeyeRefreshable(invalidationSignals: [.receipts, .general]) {
            await store.load()
        }
    }

    private var receiptsContent: some View {
        HSplitView {
            ReceiptsTableView(store: store)
                .popeyeSplitPane(minWidth: 400)
            inspectorColumn
                .popeyeSplitPane(minWidth: 300)
        }
    }

    @ViewBuilder
    private var inspectorColumn: some View {
        if let receipt = store.selectedReceipt {
            ReceiptInspectorView(receipt: receipt)
        } else if store.isLoadingDetail {
            LoadingStateView(title: "Loading receipt details...")
        } else {
            Text("Select a receipt to inspect")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
