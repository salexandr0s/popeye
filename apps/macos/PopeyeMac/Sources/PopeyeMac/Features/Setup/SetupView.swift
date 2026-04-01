import SwiftUI
import PopeyeAPI

struct SetupView: View {
    @Bindable var store: SetupStore
    @Environment(AppModel.self) private var appModel
    @State private var debouncer = ReloadDebouncer()

    private var session: SetupSessionSnapshot {
        SetupSessionSnapshot(
            connectionState: appModel.connectionState,
            baseURL: appModel.baseURL,
            sseConnected: appModel.sseConnected
        )
    }

    private var cards: [SetupCard] {
        SetupCardFactory.makeCards(
            session: session,
            connections: store.connections,
            relayCheckpoint: store.relayCheckpoint,
            uncertainDeliveries: store.uncertainDeliveries,
            telegramConfig: store.telegramConfig,
            mutationReceipts: store.telegramMutationReceipts
        )
    }

    private var selectedCard: SetupCard? {
        guard let selectedCardID = store.selectedCardID else { return cards.first }
        return cards.first { $0.id == selectedCardID } ?? cards.first
    }

    private var completedCount: Int {
        cards.count { $0.state.isComplete }
    }

    var body: some View {
        Group {
            if store.isLoading && cards.dropFirst().allSatisfy({ $0.state == .missing }) {
                LoadingStateView(title: "Loading setup…")
            } else if let error = store.error, store.connections.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                setupContent
            }
        }
        .navigationTitle("Setup")
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal,
               [.connections, .telegram, .general].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var setupContent: some View {
        HSplitView {
            VStack(spacing: 0) {
                checklistHeader
                Divider()
                List(cards, selection: $store.selectedCardID) { card in
                    SetupCardRowView(card: card)
                        .tag(card.id)
                }
                .listStyle(.sidebar)
            }
            .frame(minWidth: 300, idealWidth: 340, maxWidth: 380)

            if let selectedCard {
                SetupDetailView(
                    card: selectedCard,
                    statusMessage: store.statusMessage(for: selectedCard.id),
                    errorMessage: store.errorMessage(for: selectedCard.id),
                    isPerformingPrimaryAction: store.isPerformingAction(for: selectedCard.id),
                    runPrimaryAction: runPrimaryAction,
                    openDestination: openDestination
                )
                    .frame(minWidth: 480)
            } else {
                ContentUnavailableView("Select a setup item", systemImage: "checklist")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .sheet(isPresented: $store.isPresentingTelegramSetup) {
            TelegramSetupSheet(
                draft: $store.telegramSetupDraft,
                isSaving: store.isPerformingAction(for: .telegram),
                errorMessage: store.errorMessage(for: .telegram),
                onCancel: store.dismissTelegramSetup,
                onSubmit: {
                    Task { await store.submitTelegramSetup() }
                }
            )
        }
    }

    private var checklistHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Setup Checklist")
                .font(.title3.bold())

            Text(appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID)
                .font(.callout)
                .foregroundStyle(.secondary)

            Text("\(completedCount) of \(cards.count) ready")
                .foregroundStyle(.secondary)

            ProgressView(value: Double(completedCount), total: Double(cards.count))

            Text(checklistSummary)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.background.secondary)
    }

    private var checklistSummary: String {
        if cards.contains(where: { $0.state == .reauthRequired }) {
            return "At least one provider needs reauthorization before setup is complete."
        }

        let remaining = cards.count - completedCount
        if remaining == 0 {
            return "Core setup is visible and ready for daily use."
        }

        return "\(remaining) setup item\(remaining == 1 ? "" : "s") still need attention."
    }

    private func reload() {
        Task { await store.load() }
    }

    private func openDestination(_ destination: SetupCardDestination) {
        switch destination {
        case .connections(let id):
            appModel.navigateToConnection(id: id)
        case .telegram:
            appModel.navigateToTelegram()
        }
    }

    private func runPrimaryAction(_ action: SetupCardAction) {
        guard let selectedCard else { return }
        store.beginPrimaryAction(action, for: selectedCard.id)
    }
}
