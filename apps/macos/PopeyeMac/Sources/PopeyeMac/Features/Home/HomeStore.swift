import Foundation
import PopeyeAPI

@Observable @MainActor
final class HomeStore {
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            summary = nil
            error = nil
        }
    }

    var summary: HomeSummaryDTO?
    var isLoading = false
    var error: APIError?

    private let systemService: SystemService

    init(client: ControlAPIClient) {
        self.systemService = SystemService(client: client)
    }

    var healthyProviderCount: Int {
        summary?.setup.healthyProviderCount ?? 0
    }

    var attentionProviderCount: Int {
        summary?.setup.attentionProviderCount ?? 0
    }

    var supportedProviderCount: Int { summary?.setup.supportedProviderCount ?? 4 }

    var automationAttention: [AutomationRecordDTO] {
        summary?.automationAttention ?? []
    }

    var automationDueSoon: [AutomationRecordDTO] {
        summary?.automationDueSoon ?? []
    }

    var telegramStatusLabel: String {
        summary?.setup.telegramStatusLabel ?? "Not configured"
    }

    func load() async {
        isLoading = true
        error = nil

        do {
            summary = try await systemService.loadHomeSummary(workspaceId: workspaceID)
        } catch let apiError as APIError {
            error = apiError
        } catch {
            self.error = .transportUnavailable
        }

        isLoading = false
    }
}
