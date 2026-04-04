import PopeyeAPI

enum SetupCardFactory {
    static func makeCards(
        session: SetupSessionSnapshot,
        connections: [ConnectionDTO],
        oauthProviders: [OAuthProviderAvailabilityDTO] = [],
        relayCheckpoint: TelegramRelayCheckpointDTO?,
        uncertainDeliveries: [TelegramDeliveryDTO],
        telegramConfig: TelegramConfigSnapshotDTO?,
        mutationReceipts: [MutationReceiptDTO]
    ) -> [SetupCard] {
        let context = SetupCardBuildContext(
            session: session,
            connections: connections,
            oauthProviders: oauthProviders,
            relayCheckpoint: relayCheckpoint,
            uncertainDeliveries: uncertainDeliveries,
            telegramConfig: telegramConfig,
            mutationReceipts: mutationReceipts
        )

        return [
            SetupDaemonCardBuilder.makeCard(session: context.session),
            SetupProviderCardBuilder.makeCard(id: .github, connections: context.connections, oauthProviders: context.oauthProviders),
            SetupProviderCardBuilder.makeCard(id: .gmail, connections: context.connections, oauthProviders: context.oauthProviders),
            SetupProviderCardBuilder.makeCard(id: .googleCalendar, connections: context.connections, oauthProviders: context.oauthProviders),
            SetupTelegramCardBuilder.makeCard(context: context),
        ]
    }
}
