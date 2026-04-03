import Foundation
import Observation
import PopeyeAPI

@Observable
@MainActor
final class HomeStore {
    struct Dependencies: Sendable {
        var loadSummary: @Sendable (_ workspaceID: String) async throws -> HomeSummaryDTO

        static func live(client: ControlAPIClient) -> Dependencies {
            let systemService = SystemService(client: client)
            return Dependencies(
                loadSummary: { workspaceID in
                    try await systemService.loadHomeSummary(workspaceId: workspaceID)
                }
            )
        }
    }

    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            summary = nil
            loadPhase = .idle
            refreshPhase = .idle
        }
    }

    var summary: HomeSummaryDTO?
    var loadPhase: ScreenLoadPhase = .idle
    var refreshPhase: ScreenOperationPhase = .idle

    private let dependencies: Dependencies

    init(client: ControlAPIClient) {
        self.dependencies = .live(client: client)
    }

    init(dependencies: Dependencies) {
        self.dependencies = dependencies
    }

    var error: APIError? { loadPhase.error }
    var refreshError: APIError? { refreshPhase.error }

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
        if summary == nil {
            loadPhase = .loading
            do {
                summary = try await dependencies.loadSummary(workspaceID)
                loadPhase = .loaded
                refreshPhase = .idle
            } catch {
                loadPhase = .failed(APIError.from(error))
            }
            return
        }

        refreshPhase = .loading
        do {
            summary = try await dependencies.loadSummary(workspaceID)
            loadPhase = .loaded
            refreshPhase = .idle
        } catch {
            refreshPhase = .failed(APIError.from(error))
        }
    }
}
