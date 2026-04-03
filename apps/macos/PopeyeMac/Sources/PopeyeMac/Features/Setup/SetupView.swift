import SwiftUI
import PopeyeAPI

struct SetupView: View {
    @Bindable var store: SetupStore
    @Environment(AppModel.self) private var appModel

    private var session: SetupSessionSnapshot {
        SetupSessionSnapshot(
            connectionState: appModel.connectionState,
            baseURL: appModel.baseURL,
            sseConnected: appModel.sseConnected
        )
    }

    private var checklistPresentation: SetupChecklistPresentation {
        store.checklistPresentation(session: session)
    }

    var body: some View {
        let checklistPresentation = checklistPresentation

        Group {
            if store.isLoading && checklistPresentation.shouldShowLoadingState {
                LoadingStateView(title: "Loading setup…")
            } else if let error = store.error, store.connections.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                setupContent(presentation: checklistPresentation)
            }
        }
        .navigationTitle("Setup")
        .popeyeRefreshable(invalidationSignals: [.connections, .telegram, .general]) {
            await store.load()
        }
        .task(id: appModel.selectedWorkspaceID) {
            store.workspaceID = appModel.selectedWorkspaceID
            await store.load()
        }
    }

    private func setupContent(presentation: SetupChecklistPresentation) -> some View {
        HSplitView {
            SetupChecklistPane(
                selectedCardID: $store.selectedCardID,
                workspaceName: appModel.selectedWorkspace?.name ?? appModel.selectedWorkspaceID,
                cards: presentation.cards,
                completedCount: presentation.completedCount,
                summary: presentation.summary
            )
            .frame(minWidth: 300, idealWidth: 340, maxWidth: 380)

            if let selectedCard = presentation.selectedCard {
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
        guard let selectedCard = checklistPresentation.selectedCard else { return }
        store.beginPrimaryAction(action, for: selectedCard.id)
    }
}
