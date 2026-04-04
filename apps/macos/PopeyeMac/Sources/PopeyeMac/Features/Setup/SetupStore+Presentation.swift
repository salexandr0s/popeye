import Foundation

extension SetupStore {
    func checklistPresentation(session: SetupSessionSnapshot) -> SetupChecklistPresentation {
        SetupChecklistPresentation(
            session: session,
            connections: connections,
            oauthProviders: oauthProviders,
            relayCheckpoint: relayCheckpoint,
            uncertainDeliveries: uncertainDeliveries,
            telegramConfig: telegramConfig,
            mutationReceipts: telegramMutationReceipts,
            selectedCardID: selectedCardID
        )
    }

    func statusMessage(for cardID: SetupCardID) -> String? {
        guard activity?.cardID == cardID else { return nil }
        return activity?.message
    }

    func errorMessage(for cardID: SetupCardID) -> String? {
        guard actionErrorCardID == cardID else { return nil }
        return actionErrorMessage
    }

    func isPerformingAction(for cardID: SetupCardID) -> Bool {
        activity?.cardID == cardID
    }

    func clearActionError() {
        actionErrorMessage = nil
        actionErrorCardID = nil
    }

    func setActionError(_ message: String?, for cardID: SetupCardID) {
        actionErrorCardID = cardID
        actionErrorMessage = message
    }

    func applySnapshotToDraft(force: Bool) {
        guard force || isPresentingTelegramSetup == false else { return }
        telegramSetupDraft.enabled = telegramConfig?.persisted.enabled ?? false
        telegramSetupDraft.allowedUserId = telegramConfig?.persisted.allowedUserId ?? ""
        telegramSetupDraft.currentSecretRefId = telegramConfig?.persisted.secretRefId
    }
}
