import SwiftUI
import PopeyeAPI

struct TelegramView: View {
    @Bindable var store: TelegramStore

    var body: some View {
        Group {
            if store.isLoading && store.deliveries.isEmpty {
                LoadingStateView(title: "Loading deliveries...")
            } else if store.deliveries.isEmpty {
                EmptyStateView(
                    icon: "paperplane",
                    title: "No deliveries",
                    description: "Telegram deliveries appear when messages are sent to chats."
                )
            } else {
                deliveriesContent
            }
        }
        .navigationTitle("Telegram")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Filter deliveries…")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Picker("Status", selection: $store.statusFilter) {
                    Text("All Statuses").tag(String?.none)
                    Divider()
                    ForEach(store.availableStatuses, id: \.self) { status in
                        Text(status.capitalized).tag(Optional(status))
                    }
                }
                .frame(width: 140)
            }
        }
        .task {
            await store.load()
        }
        .onChange(of: store.selectedId) { _, newId in
            if let id = newId {
                Task { await store.loadDetail(id: id) }
            }
        }
        .popeyeRefreshable(invalidationSignals: [.telegram, .general]) {
            await store.load()
        }
    }

    private var deliveriesContent: some View {
        HSplitView {
            deliveriesList
                .popeyeSplitPane(minWidth: 350)
            inspectorColumn
                .popeyeSplitPane(minWidth: 300)
        }
    }

    private var deliveriesList: some View {
        VStack(spacing: 0) {
            TelegramRelayCheckpointCard(checkpoint: store.relayCheckpoint)
                .padding(.vertical, 8)
            List(store.filteredDeliveries, selection: $store.selectedId) { delivery in
                TelegramDeliveryRow(delivery: delivery)
            }
            .listStyle(.inset)
        }
    }

    @ViewBuilder
    private var inspectorColumn: some View {
        if let delivery = store.selectedDelivery {
            TelegramDeliveryInspector(delivery: delivery, store: store)
        } else {
            Text("Select a delivery to inspect")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
