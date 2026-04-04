import Foundation
import PopeyeAPI

struct SetupChecklistPresentation {
    let cards: [SetupCard]
    let selectedCard: SetupCard?
    let completedCount: Int
    let summary: String
    let shouldShowLoadingState: Bool

    init(
        session: SetupSessionSnapshot,
        connections: [ConnectionDTO],
        oauthProviders: [OAuthProviderAvailabilityDTO] = [],
        relayCheckpoint: TelegramRelayCheckpointDTO?,
        uncertainDeliveries: [TelegramDeliveryDTO],
        telegramConfig: TelegramConfigSnapshotDTO?,
        mutationReceipts: [MutationReceiptDTO],
        selectedCardID: SetupCardID?
    ) {
        self.init(
            cards: SetupCardFactory.makeCards(
                session: session,
                connections: connections,
                oauthProviders: oauthProviders,
                relayCheckpoint: relayCheckpoint,
                uncertainDeliveries: uncertainDeliveries,
                telegramConfig: telegramConfig,
                mutationReceipts: mutationReceipts
            ),
            selectedCardID: selectedCardID
        )
    }

    init(cards: [SetupCard], selectedCardID: SetupCardID?) {
        self.cards = cards
        self.selectedCard = Self.resolveSelectedCard(in: cards, selectedCardID: selectedCardID)
        self.completedCount = cards.count { $0.state.isComplete }
        self.summary = Self.makeSummary(cards: cards, completedCount: completedCount)
        self.shouldShowLoadingState = cards.dropFirst().allSatisfy { $0.state == .missing }
    }

    private static func resolveSelectedCard(in cards: [SetupCard], selectedCardID: SetupCardID?) -> SetupCard? {
        guard let selectedCardID else { return cards.first }
        return cards.first { $0.id == selectedCardID } ?? cards.first
    }

    private static func makeSummary(cards: [SetupCard], completedCount: Int) -> String {
        if cards.contains(where: { $0.state == .reauthRequired }) {
            return "At least one provider needs reauthorization before setup is complete."
        }

        let remaining = cards.count - completedCount
        if remaining == 0 {
            return "Core setup is visible and ready for daily use."
        }

        return "\(remaining) setup item\(remaining == 1 ? "" : "s") still need attention."
    }
}
