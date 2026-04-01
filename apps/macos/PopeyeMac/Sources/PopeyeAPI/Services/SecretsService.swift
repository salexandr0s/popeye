import Foundation

public struct SecretsService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func storeSecret(_ input: StoreSecretInput) async throws -> SecretRefDTO {
        try await client.storeSecret(input: input)
    }
}
