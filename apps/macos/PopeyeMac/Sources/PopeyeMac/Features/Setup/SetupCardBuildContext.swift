import PopeyeAPI

struct SetupCardBuildContext {
    let session: SetupSessionSnapshot
    let connections: [ConnectionDTO]
    let relayCheckpoint: TelegramRelayCheckpointDTO?
    let uncertainDeliveries: [TelegramDeliveryDTO]
    let telegramConfig: TelegramConfigSnapshotDTO?
    let mutationReceipts: [MutationReceiptDTO]
}
