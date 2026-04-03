import PopeyeAPI

enum SetupCardFactory {
    static func makeCards(
        session: SetupSessionSnapshot,
        connections: [ConnectionDTO],
        relayCheckpoint: TelegramRelayCheckpointDTO?,
        uncertainDeliveries: [TelegramDeliveryDTO],
        telegramConfig: TelegramConfigSnapshotDTO?,
        mutationReceipts: [MutationReceiptDTO]
    ) -> [SetupCard] {
        let context = SetupCardBuildContext(
            session: session,
            connections: connections,
            relayCheckpoint: relayCheckpoint,
            uncertainDeliveries: uncertainDeliveries,
            telegramConfig: telegramConfig,
            mutationReceipts: mutationReceipts
        )

        return [
            SetupDaemonCardBuilder.makeCard(session: context.session),
            SetupProviderCardBuilder.makeCard(id: .github, connections: context.connections),
            SetupProviderCardBuilder.makeCard(id: .gmail, connections: context.connections),
            SetupProviderCardBuilder.makeCard(id: .googleCalendar, connections: context.connections),
            SetupTelegramCardBuilder.makeCard(context: context),
        ]
    }
}
