import Foundation

public struct ProviderAuthService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadConfig() async throws -> [ProviderAuthConfigDTO] {
        try await client.providerAuthConfig()
    }

    public func saveConfig(provider: String, input: ProviderAuthConfigUpdateInput) async throws -> [ProviderAuthConfigDTO] {
        try await client.saveProviderAuthConfig(provider: provider, input: input)
    }
}
