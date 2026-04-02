import Foundation

public struct AutomationsService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadAutomations(workspaceId: String) async throws -> [AutomationRecordDTO] {
        try await client.listAutomations(workspaceId: workspaceId)
    }

    public func loadAutomation(id: String) async throws -> AutomationDetailDTO {
        try await client.getAutomation(id: id)
    }

    public func update(id: String, input: AutomationUpdateInput) async throws -> AutomationDetailDTO {
        try await client.updateAutomation(id: id, input: input)
    }

    public func runNow(id: String) async throws -> AutomationDetailDTO {
        try await client.runAutomationNow(id: id)
    }

    public func pause(id: String) async throws -> AutomationDetailDTO {
        try await client.pauseAutomation(id: id)
    }

    public func resume(id: String) async throws -> AutomationDetailDTO {
        try await client.resumeAutomation(id: id)
    }
}
