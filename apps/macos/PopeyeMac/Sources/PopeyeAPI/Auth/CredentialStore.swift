import Foundation

public struct CredentialStore: Sendable {
    private let keychain = KeychainStore()

    public init() {}

    public func saveToken(_ token: String) throws {
        try keychain.save(token)
    }

    public func retrieveToken() throws -> String? {
        try keychain.retrieve()
    }

    public func deleteToken() throws {
        try keychain.delete()
    }
}
