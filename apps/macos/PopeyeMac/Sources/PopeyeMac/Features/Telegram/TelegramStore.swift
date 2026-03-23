import Foundation
import PopeyeAPI

@Observable @MainActor
final class TelegramStore {
    var deliveries: [TelegramDeliveryDTO] = []
    var relayCheckpoint: TelegramRelayCheckpointDTO?
    var selectedId: String?
    var selectedDetail: TelegramDeliveryDetailSnapshot?
    var isLoading = false
    var isLoadingDetail = false
    var searchText = ""
    var statusFilter: String?

    var filteredDeliveries: [TelegramDeliveryDTO] {
        var result = deliveries
        if let filter = statusFilter {
            result = result.filter { $0.status == filter }
        }
        if !searchText.isEmpty {
            result = result.filter {
                $0.id.localizedStandardContains(searchText)
                || $0.chatId.localizedStandardContains(searchText)
                || $0.status.localizedStandardContains(searchText)
                || ($0.runId?.localizedStandardContains(searchText) ?? false)
            }
        }
        return result
    }

    var availableStatuses: [String] {
        Array(Set(deliveries.map(\.status))).sorted()
    }

    let mutations = MutationExecutor()
    var mutationState: MutationState { mutations.state }

    private let telegramService: TelegramService
    private let client: ControlAPIClient

    init(client: ControlAPIClient) {
        self.client = client
        self.telegramService = TelegramService(client: client)
    }

    var selectedDelivery: TelegramDeliveryDTO? {
        guard let id = selectedId else { return nil }
        return deliveries.first { $0.id == id }
    }

    var uncertainCount: Int {
        deliveries.count(where: { $0.status == "uncertain" })
    }

    var pendingCount: Int {
        deliveries.count(where: { $0.status == "pending" })
    }

    func load() async {
        isLoading = true
        do {
            async let uncertain = telegramService.loadUncertainDeliveries()
            async let checkpoint = telegramService.loadRelayCheckpoint()
            deliveries = try await uncertain
            relayCheckpoint = try? await checkpoint
        } catch {
            PopeyeLogger.refresh.error("Telegram deliveries load failed: \(error)")
        }
        isLoading = false
    }

    func loadDetail(id: String) async {
        isLoadingDetail = true
        do {
            selectedDetail = try await telegramService.loadDeliveryDetail(id: id)
        } catch {
            PopeyeLogger.refresh.error("Telegram delivery detail load failed: \(error)")
            selectedDetail = nil
        }
        isLoadingDetail = false
    }

    // MARK: - Mutations

    func resolveDelivery(id: String, action: String, note: String? = nil, sentMessageId: Int? = nil) async {
        let input = TelegramDeliveryResolveInput(
            action: action,
            operatorNote: note,
            sentTelegramMessageId: sentMessageId
        )
        await mutations.execute(
            action: { [client] in _ = try await client.resolveTelegramDelivery(id: id, input: input) },
            successMessage: "Delivery resolved (\(action))",
            fallbackError: "Resolve failed",
            reload: { [weak self] in
                await self?.load()
                if let id = self?.selectedId {
                    await self?.loadDetail(id: id)
                }
            }
        )
    }

    func dismissMutation() { mutations.dismiss() }

    static func canResolve(status: String) -> Bool {
        MutationEligibility.canResolveTelegramDelivery(status: status)
    }
}
